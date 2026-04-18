// Engine de conciliacao BANCO: cruza pagamentos do PDV (pagamento.dataCredito)
// com lancamentos do banco. Agrupa por (data_credito, forma Pix/Cartao),
// subset sum pra achar creditos do banco que somam o total esperado.

import { db, schema } from '@concilia/db';
import { matchCieloBanco } from '@concilia/conciliador/engine';
import { and, eq, gte, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';

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

function isoToBr(d: string | Date): string {
  const iso = typeof d === 'string' ? d : d.toISOString().slice(0, 10);
  const [y, m, day] = iso.split('-');
  return `${day}/${m}/${y}`;
}

/** Formas de pagamento do PDV que nao entram na conciliacao bancaria.
 * Pix Manual cai direto no banco via QR, mas nao tem agenda previsivel
 * (cada transacao independente), entao nao da pra agrupar/bater em grupos. */
const FORMAS_EXCLUIR = new Set(['Dinheiro', 'Voucher', 'iFood', 'Pix Manual', 'iFood Online']);

export async function rodarConciliacaoBanco(opts: {
  filialId: string;
  dataInicio: string; // YYYY-MM-DD — data de credito prevista
  dataFim: string;
}): Promise<BancoResultado> {
  const { filialId, dataFim } = opts;
  let { dataInicio } = opts;

  const [fil] = await db
    .select({ dataInicioConciliacao: schema.filial.dataInicioConciliacao })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const corte = fil?.dataInicioConciliacao ?? null;
  if (corte && dataInicio < corte) dataInicio = corte;

  const dtIni = new Date(dataInicio + 'T00:00:00');
  const dtFim = new Date(dataFim + 'T23:59:59');

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
    // Pagamentos com data_credito no periodo — so cartao/pix (exclui dinheiro)
    const pagamentos = await db
      .select({
        id: schema.pagamento.id,
        formaPagamento: schema.pagamento.formaPagamento,
        valor: schema.pagamento.valor,
        dataPagamento: schema.pagamento.dataPagamento,
        dataCredito: schema.pagamento.dataCredito,
        nsu: schema.pagamento.nsuTransacao,
        codigoPedidoExterno: schema.pagamento.codigoPedidoExterno,
      })
      .from(schema.pagamento)
      .where(
        and(
          eq(schema.pagamento.filialId, filialId),
          isNotNull(schema.pagamento.dataCredito),
          gte(schema.pagamento.dataCredito, dtIni),
          lte(schema.pagamento.dataCredito, dtFim),
          or(
            ...[...FORMAS_EXCLUIR].map((f) => ne(schema.pagamento.formaPagamento, f)),
          ),
        ),
      );

    // Filtra em JS pra cobrir null/normalizacao
    const liquidaveis = pagamentos.filter(
      (p) => p.formaPagamento && !FORMAS_EXCLUIR.has(p.formaPagamento),
    );

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

    // Mapeia pagamento -> formato esperado pelo matcher (uma "venda prometida")
    const pseudoRecebiveis = liquidaveis.map((p) => ({
      id: p.id,
      nsu: p.nsu ?? `PDV-${p.id}`,
      dataPagamento: isoToBr(p.dataCredito!),
      // Normaliza: Pix* -> Pix, resto -> nao-Pix (vira CARTAO no matcher)
      formaPagamento: /pix/i.test(p.formaPagamento ?? '') ? 'Pix' : (p.formaPagamento ?? ''),
      valorLiquido: Number(p.valor),
    }));

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

    // Limpa excecoes abertas do mesmo processo pra esta filial
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
      const pgsDoGrupo = liquidaveis.filter(
        (p) =>
          isoToBr(p.dataCredito!) === g.dataPagamento &&
          (/pix/i.test(p.formaPagamento ?? '') ? 'PIX' : 'CARTAO') === g.tipo,
      );
      const pedidos = pgsDoGrupo
        .map((p) => p.codigoPedidoExterno)
        .filter((n): n is number => !!n)
        .slice(0, 5);
      const pedidosTxt = pedidos.length
        ? ` Pedidos: ${pedidos.join(', ')}${pgsDoGrupo.length > pedidos.length ? ', ...' : ''}.`
        : '';
      novas.push({
        filialId,
        processo: PROCESSO_BANCO,
        tipo: TIPO_BANCO.CIELO_NAO_PAGO,
        severidade: 'ALTA',
        descricao: `Previsto R$ ${g.valorTotal.toFixed(2)} (${g.qtdRecebiveis} ${g.tipo === 'PIX' ? 'Pix' : 'cartões'}) em ${g.dataPagamento}, não achei crédito correspondente no extrato.${pedidosTxt}`,
        valor: String(g.valorTotal),
        pagamentoId: pgsDoGrupo[0]?.id ?? null,
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
