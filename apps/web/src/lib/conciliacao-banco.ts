// Engine de conciliacao BANCO: cruza pagamentos do PDV (pagamento.dataCredito)
// com lancamentos do banco. Agrupa por (data_credito, forma Pix/Cartao),
// subset sum pra achar creditos do banco que somam o total esperado.

import { db, schema } from '@concilia/db';
import { matchCieloBanco } from '@concilia/conciliador/engine';
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';

export const PROCESSO_BANCO = 'BANCO';

export const TIPO_BANCO = {
  CIELO_NAO_PAGO: 'CIELO_NAO_PAGO',
  CREDITO_SEM_CIELO: 'CREDITO_SEM_CIELO',
} as const;

export interface BancoResumo {
  conciliados: { qtd: number; valor: number };
  cieloNaoPago: { qtd: number; valor: number };
  creditoSemCielo: { qtd: number; valor: number };
}

export interface BancoResultado {
  execucaoId: string;
  dataInicioEfetiva: string;
  dataFimEfetiva: string;
  resumo: BancoResumo;
  excecoesCriadas: number;
}

import { dateToBrYmd } from './datas';

function isoToBr(d: string | Date): string {
  const iso = typeof d === 'string' ? d : dateToBrYmd(d);
  const [y, m, day] = iso.split('-');
  return `${day}/${m}/${y}`;
}

/** Formas de pagamento do PDV que nao entram na conciliacao bancaria. */
const FORMAS_EXCLUIR = new Set(['Dinheiro', 'Voucher', 'iFood', 'iFood Online']);

const ADQUIRENTE_CIELO = 'CIELO';

import type { TaxasFilial, TaxasPorBandeira, EstabelecimentoConfig } from '@concilia/db/schema';
import { diasFechados } from './fechamento';

/** Defaults de taxa Cielo (%) quando a filial nao tem config propria. */
export const TAXAS_DEFAULT: TaxasPorBandeira = {
  pix: 0.49,
  debito: { visa: 0.90, mastercard: 0.90, elo: 1.45 },
  credito_a_vista: { visa: 3.32, mastercard: 3.32, elo: 3.87, amex: 3.82, diners: 3.32 },
};

function normalizarBandeira(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

/** Escolhe o conjunto de taxas baseado no codigo_estabelecimento (EC).
 * Fallback: taxas.default → TAXAS_DEFAULT hardcoded. */
function resolverTaxas(
  taxas: TaxasFilial | null | undefined,
  ec: string | null | undefined,
): TaxasPorBandeira {
  if (taxas) {
    if (ec && Array.isArray(taxas.ecs)) {
      const match = taxas.ecs.find((e: EstabelecimentoConfig) => e.codigo === ec);
      if (match) return match;
    }
    if (taxas.default) return taxas.default;
  }
  return TAXAS_DEFAULT;
}

function obterTaxaPercent(
  t: TaxasPorBandeira,
  forma: string,
  bandeira: string | null | undefined,
): number {
  const f = forma.toLowerCase();
  const b = normalizarBandeira(bandeira);
  if (f.includes('pix')) return Number(t.pix ?? TAXAS_DEFAULT.pix);
  if (f.includes('debito') || f.includes('débito')) {
    const map = t.debito ?? TAXAS_DEFAULT.debito;
    return Number(map[b] ?? map['visa'] ?? TAXAS_DEFAULT.debito.visa);
  }
  if (f.includes('credito') || f.includes('crédito')) {
    const map = t.credito_a_vista ?? TAXAS_DEFAULT.credito_a_vista;
    return Number(map[b] ?? map['visa'] ?? TAXAS_DEFAULT.credito_a_vista.visa);
  }
  return 0;
}

export async function rodarConciliacaoBanco(opts: {
  filialId: string;
  dataInicio: string; // YYYY-MM-DD — data de credito prevista
  dataFim: string;
}): Promise<BancoResultado> {
  const { filialId, dataFim } = opts;
  let { dataInicio } = opts;

  const [fil] = await db
    .select({
      dataInicioConciliacao: schema.filial.dataInicioConciliacao,
      taxas: schema.filial.taxas,
    })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const corte = fil?.dataInicioConciliacao ?? null;
  if (corte && dataInicio < corte) dataInicio = corte;
  const taxasFilial = (fil?.taxas as TaxasFilial | null) ?? null;

  const dtIni = new Date(dataInicio + 'T00:00:00-03:00');
  const dtFim = new Date(dataFim + 'T23:59:59-03:00');

  const [exec] = await db
    .insert(schema.execucaoConciliacao)
    .values({
      filialId,
      processo: PROCESSO_BANCO,
      dataInicio: dtIni,
      dataFim: dtFim,
      status: 'EM_ANDAMENTO',
    })
    .returning({ id: schema.execucaoConciliacao.id });
  const execId = exec!.id;

  try {
    // Carrega mapeamento de pagamentos com divergencia ACEITA pelo usuario
    // (ela indica "o valor correto eh o da Cielo, nao o do PDV").
    const aceitasRows = await db
      .select({
        pagamentoId: schema.excecao.pagamentoId,
        vendaValor: schema.vendaAdquirente.valorBruto,
        vendaEc: schema.vendaAdquirente.codigoEstabelecimento,
        vendaBandeira: schema.vendaAdquirente.bandeira,
        vendaForma: schema.vendaAdquirente.formaPagamento,
      })
      .from(schema.excecao)
      .innerJoin(
        schema.vendaAdquirente,
        eq(schema.vendaAdquirente.id, schema.excecao.vendaAdquirenteId),
      )
      .where(
        and(
          eq(schema.excecao.filialId, filialId),
          eq(schema.excecao.tipo, 'DIVERGENCIA_VALOR_OPERADORA'),
          isNotNull(schema.excecao.aceitaEm),
        ),
      );
    const divergenciasAceitas = new Map<
      string,
      { valor: number; ec: string | null; bandeira: string | null; forma: string | null }
    >();
    for (const a of aceitasRows) {
      if (a.pagamentoId) {
        divergenciasAceitas.set(a.pagamentoId, {
          valor: Number(a.vendaValor),
          ec: a.vendaEc,
          bandeira: a.vendaBandeira,
          forma: a.vendaForma,
        });
      }
    }

    // Carrega recebíveis Cielo com data_pagamento no periodo — e' a fonte
    // da verdade (valor liquido exato ja descontado pela Cielo + data real
    // do credito). Evita usar data_credito do PDV (pode ser errada) e
    // calculos de taxa (podem divergir do real).
    const recebiveisCielo = await db
      .select({
        id: schema.recebivelAdquirente.id,
        nsu: schema.recebivelAdquirente.nsu,
        valorLiquido: schema.recebivelAdquirente.valorLiquido,
        dataPagamento: schema.recebivelAdquirente.dataPagamento,
        formaPagamento: schema.recebivelAdquirente.formaPagamento,
      })
      .from(schema.recebivelAdquirente)
      .where(
        and(
          eq(schema.recebivelAdquirente.filialId, filialId),
          eq(schema.recebivelAdquirente.adquirente, ADQUIRENTE_CIELO),
          gte(schema.recebivelAdquirente.dataPagamento, dataInicio),
          lte(schema.recebivelAdquirente.dataPagamento, dataFim),
        ),
      );

    // Filtra dias fechados (pelo data_pagamento do recebivel — dia do credito).
    const fechados = await diasFechados(filialId, PROCESSO_BANCO, dataInicio, dataFim);

    // Lancamentos banco no mesmo periodo (data_movimento)
    const lancamentos = await db
      .select({
        id: schema.lancamentoBanco.id,
        dataMovimento: schema.lancamentoBanco.dataMovimento,
        tipo: schema.lancamentoBanco.tipo,
        valor: schema.lancamentoBanco.valor,
        descricao: schema.lancamentoBanco.descricao,
        idTransacao: schema.lancamentoBanco.idTransacao,
      })
      .from(schema.lancamentoBanco)
      .where(
        and(
          eq(schema.lancamentoBanco.filialId, filialId),
          gte(schema.lancamentoBanco.dataMovimento, dataInicio),
          lte(schema.lancamentoBanco.dataMovimento, dataFim),
        ),
      );

    // Mapeia recebivel -> formato esperado pelo matcher.
    // EXCLUI:
    //  - dias fechados (preserva fechamento)
    //  - recebiveis com valor_liquido <= 0 (tarifas/aluguel Cielo — Cielo
    //    desconta da agenda, nao deposita como credito no banco, entao nao
    //    entra no matcher positivo).
    const pseudoRecebiveis = recebiveisCielo
      .filter((r) => !fechados.has(r.dataPagamento))
      .filter((r) => Number(r.valorLiquido) > 0)
      .map((r) => {
        const forma = r.formaPagamento ?? '';
        const isPix = /pix/i.test(forma);
        return {
          id: r.id,
          nsu: r.nsu,
          dataPagamento: r.dataPagamento.split('-').reverse().join('/'), // YYYY-MM-DD -> DD/MM/YYYY
          formaPagamento: isPix ? 'Pix' : forma,
          valorLiquido: Number(r.valorLiquido),
        };
      });


    const result = matchCieloBanco(
      pseudoRecebiveis,
      lancamentos.map((l) => ({
        id: l.id,
        dataMovimento: isoToBr(l.dataMovimento),
        tipo: l.tipo as 'C' | 'D',
        valor: Number(l.valor),
        descricao: l.descricao ?? '',
        idTransacao: l.idTransacao ?? '',
      })),
    );

    // Limpa excecoes abertas do processo BANCO no periodo (preserva dias fechados).
    // Scope baseado em recebivel_adquirente.dataPagamento no range.
    const recebivelIdsScope = recebiveisCielo
      .filter((r) => !fechados.has(r.dataPagamento))
      .map((r) => r.id);
    await db
      .delete(schema.excecao)
      .where(
        and(
          eq(schema.excecao.filialId, filialId),
          eq(schema.excecao.processo, PROCESSO_BANCO),
          isNull(schema.excecao.aceitaEm),
        ),
      );

    const novas: Array<typeof schema.excecao.$inferInsert> = [];

    // Grupos (data, forma) que nao bateram no extrato
    for (const g of result.gruposSemMatch) {
      novas.push({
        filialId,
        processo: PROCESSO_BANCO,
        tipo: TIPO_BANCO.CIELO_NAO_PAGO,
        severidade: 'ALTA',
        descricao: `Previsto R$ ${g.valorTotal.toFixed(2)} (${g.qtdRecebiveis} ${g.tipo === 'PIX' ? 'Pix' : 'cartões'}) em ${g.dataPagamento}, não achei crédito correspondente no extrato.`,
        valor: String(g.valorTotal),
      });
    }

    // Creditos do banco sobrando (sem explicacao)
    for (const l of result.creditosSobrando) {
      novas.push({
        filialId,
        processo: PROCESSO_BANCO,
        tipo: TIPO_BANCO.CREDITO_SEM_CIELO,
        severidade: 'MEDIA',
        descricao: `Crédito no banco de R$ ${l.valor.toFixed(2)} em ${l.dataMovimento} (${l.descricao}) sem origem nos pagamentos do PDV.`,
        valor: String(l.valor),
        lancamentoBancoId: l.id ?? null,
      });
    }

    const CHUNK = 1000;
    for (let i = 0; i < novas.length; i += CHUNK) {
      await db.insert(schema.excecao).values(novas.slice(i, i + CHUNK));
    }

    const resumo: BancoResumo = {
      conciliados: {
        qtd: result.gruposCompletos.length,
        valor: result.gruposCompletos.reduce((s, g) => s + g.valorTotal, 0),
      },
      cieloNaoPago: {
        qtd: result.gruposSemMatch.length,
        valor: result.gruposSemMatch.reduce((s, g) => s + g.valorTotal, 0),
      },
      creditoSemCielo: {
        qtd: result.creditosSobrando.length,
        valor: result.creditosSobrando.reduce((s, l) => s + l.valor, 0),
      },
    };

    await db
      .update(schema.execucaoConciliacao)
      .set({
        finalizadoEm: new Date(),
        status: 'OK',
        resumo: resumo as unknown as Record<string, unknown>,
      })
      .where(eq(schema.execucaoConciliacao.id, execId));

    return {
      execucaoId: execId,
      dataInicioEfetiva: dataInicio,
      dataFimEfetiva: dataFim,
      resumo,
      excecoesCriadas: novas.length,
    };
  } catch (e) {
    await db
      .update(schema.execucaoConciliacao)
      .set({
        finalizadoEm: new Date(),
        status: 'ERRO',
        erro: (e as Error).message,
      })
      .where(eq(schema.execucaoConciliacao.id, execId));
    throw e;
  }
}
