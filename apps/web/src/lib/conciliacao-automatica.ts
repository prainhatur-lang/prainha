// Conciliação AUTOMÁTICA: roda as três pernas em sequência (Operadora →
// Recebíveis → Banco) e materializa o estado da cadeia POR PAGAMENTO em
// conciliacao_pagamento — a "baixa" que a tela /conciliacao lê.
//
// A materialização NÃO reimplementa regra de elegibilidade nenhuma: ela parte
// do que as engines persistiram (match_pdv_cielo + excecao) e só remonta a
// cadeia: pagamento → venda (match) → recebível (nsu+data da venda) → banco
// (subset-sum da agenda paga vs créditos do extrato, mesmo motor da perna
// Banco). Pagamento que a engine nem viu (dinheiro, fiado, dia fechado) não
// ganha linha — não é pendência, é fora do fluxo Cielo.

import { db, schema } from '@concilia/db';
import { matchCieloBanco } from '@concilia/conciliador/engine';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { rodarConciliacaoOperadora, type OperadoraResultado } from './conciliacao-operadora';
import { rodarConciliacaoRecebiveis, type RecebiveisResultado } from './conciliacao-recebiveis';
import { rodarConciliacaoBanco, type BancoResultado } from './conciliacao-banco';
import { dateToBrYmd, hojeBr } from './datas';

const ADQUIRENTE_CIELO = 'CIELO';

export type EtapaBaixa =
  | 'COMPLETO'
  | 'NAO_NA_CIELO_VENDA'
  | 'SEM_AGENDA_RECEBIVEL'
  | 'NAO_PAGO_NO_BANCO'
  | 'DIVERGENCIA_VALOR';

export interface BaixaResumo {
  /** total de pagamentos materializados */
  total: { qtd: number; valor: number };
  porEtapa: Record<EtapaBaixa, { qtd: number; valor: number }>;
  /** subconjunto de NAO_PAGO_NO_BANCO cujo crédito ainda não venceu (D+30 etc.) */
  aguardandoCredito: { qtd: number; valor: number };
  /** quebras que o usuário já aceitou com motivo (não são pendência) */
  aceitos: { qtd: number; valor: number };
}

export interface AutomaticaResultado {
  operadora: OperadoraResultado;
  recebiveis: RecebiveisResultado;
  banco: BancoResultado;
  baixa: BaixaResumo;
}

const isoParaBr = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Remonta a cadeia por pagamento a partir do que está persistido e grava em
 * conciliacao_pagamento (upsert por pagamento_id). Pode rodar sozinha (após
 * um aceite manual, por exemplo) — não dispara as engines.
 */
export async function materializarBaixa(opts: {
  filialId: string;
  dataInicio: string; // YYYY-MM-DD (data do pagamento no PDV)
  dataFim: string;
}): Promise<BaixaResumo> {
  const { filialId, dataInicio, dataFim } = opts;
  const dtIni = new Date(dataInicio + 'T00:00:00-03:00');
  const dtFim = new Date(dataFim + 'T23:59:59-03:00');
  const hoje = hojeBr();

  // 1. Pagamentos com match PDV↔Cielo no período (a perna 1 já decidiu).
  const matches = await db
    .select({
      pagamentoId: schema.matchPdvCielo.pagamentoId,
      vendaId: schema.matchPdvCielo.vendaAdquirenteId,
      valor: schema.pagamento.valor,
      dataPagamento: schema.pagamento.dataPagamento,
    })
    .from(schema.matchPdvCielo)
    .innerJoin(schema.pagamento, eq(schema.pagamento.id, schema.matchPdvCielo.pagamentoId))
    .where(
      and(
        eq(schema.matchPdvCielo.filialId, filialId),
        gte(schema.pagamento.dataPagamento, dtIni),
        lte(schema.pagamento.dataPagamento, dtFim),
      ),
    );

  // 2. Exceções da Operadora com pagamento (abertas E aceitas): são os
  //    pagamentos que a perna 1 viu e NÃO casou limpo.
  const excecoes = await db
    .select({
      pagamentoId: schema.excecao.pagamentoId,
      vendaId: schema.excecao.vendaAdquirenteId,
      tipo: schema.excecao.tipo,
      aceitaEm: schema.excecao.aceitaEm,
      valorExc: schema.excecao.valor,
      valor: schema.pagamento.valor,
      dataPagamento: schema.pagamento.dataPagamento,
    })
    .from(schema.excecao)
    .innerJoin(schema.pagamento, eq(schema.pagamento.id, schema.excecao.pagamentoId))
    .where(
      and(
        eq(schema.excecao.filialId, filialId),
        eq(schema.excecao.processo, 'OPERADORA'),
        inArray(schema.excecao.tipo, ['PDV_SEM_CIELO', 'DIVERGENCIA_VALOR_OPERADORA']),
        gte(schema.pagamento.dataPagamento, dtIni),
        lte(schema.pagamento.dataPagamento, dtFim),
      ),
    );

  // Estado da etapa 1 por pagamento. Match firme vence exceção stale.
  interface Cadeia {
    pagamentoId: string;
    valor: number;
    dia: string; // YYYY-MM-DD
    vendaId: string | null;
    etapa: EtapaBaixa;
    aceito: boolean;
    divergencia: number | null;
  }
  const porPagamento = new Map<string, Cadeia>();
  for (const e of excecoes) {
    if (!e.pagamentoId) continue;
    const aceito = e.aceitaEm != null;
    if (e.tipo === 'PDV_SEM_CIELO') {
      porPagamento.set(e.pagamentoId, {
        pagamentoId: e.pagamentoId,
        valor: Number(e.valor),
        dia: e.dataPagamento ? dateToBrYmd(e.dataPagamento) : dataInicio,
        vendaId: null,
        etapa: 'NAO_NA_CIELO_VENDA',
        aceito,
        divergencia: null,
      });
    } else {
      // Divergência: aceita = "vale o valor da Cielo", segue a cadeia com a
      // venda vinculada; aberta = pendência parada nesta etapa.
      porPagamento.set(e.pagamentoId, {
        pagamentoId: e.pagamentoId,
        valor: Number(e.valor),
        dia: e.dataPagamento ? dateToBrYmd(e.dataPagamento) : dataInicio,
        vendaId: e.vendaId,
        etapa: aceito && e.vendaId ? 'COMPLETO' : 'DIVERGENCIA_VALOR',
        aceito,
        divergencia: e.valorExc != null ? Number(e.valorExc) - Number(e.valor) : null,
      });
    }
  }
  for (const m of matches) {
    porPagamento.set(m.pagamentoId, {
      pagamentoId: m.pagamentoId,
      valor: Number(m.valor),
      dia: m.dataPagamento ? dateToBrYmd(m.dataPagamento) : dataInicio,
      vendaId: m.vendaId,
      etapa: 'COMPLETO', // provisório — as etapas 2 e 3 rebaixam abaixo
      aceito: false,
      divergencia: null,
    });
  }

  // 3. Vendas vinculadas → recebíveis pela chave (nsu, data da venda) — a
  //    mesma da perna Recebíveis (NSU é reusado pela Cielo, data desambigua).
  const vendaIds = [...new Set([...porPagamento.values()].map((c) => c.vendaId).filter(Boolean))] as string[];
  const vendas = vendaIds.length
    ? await db
        .select({
          id: schema.vendaAdquirente.id,
          nsu: schema.vendaAdquirente.nsu,
          dataVenda: schema.vendaAdquirente.dataVenda,
        })
        .from(schema.vendaAdquirente)
        .where(inArray(schema.vendaAdquirente.id, vendaIds))
    : [];
  const vendaPorId = new Map(vendas.map((v) => [v.id, v]));

  const datasVenda = vendas.map((v) => v.dataVenda).sort();
  const recebiveis = datasVenda.length
    ? await db
        .select({
          id: schema.recebivelAdquirente.id,
          nsu: schema.recebivelAdquirente.nsu,
          dataVenda: schema.recebivelAdquirente.dataVenda,
          dataPagamento: schema.recebivelAdquirente.dataPagamento,
          valorLiquido: schema.recebivelAdquirente.valorLiquido,
          formaPagamento: schema.recebivelAdquirente.formaPagamento,
        })
        .from(schema.recebivelAdquirente)
        .where(
          and(
            eq(schema.recebivelAdquirente.filialId, filialId),
            eq(schema.recebivelAdquirente.adquirente, ADQUIRENTE_CIELO),
            gte(schema.recebivelAdquirente.dataVenda, datasVenda[0]!),
            lte(schema.recebivelAdquirente.dataVenda, datasVenda[datasVenda.length - 1]!),
          ),
        )
    : [];
  const recPorNsuData = new Map<string, (typeof recebiveis)[number]>();
  for (const r of recebiveis) {
    const k = `${r.nsu}|${r.dataVenda ?? ''}`;
    if (!recPorNsuData.has(k)) recPorNsuData.set(k, r);
  }

  // 4. O que da agenda JÁ CAIU no banco: mesmo motor da perna Banco, sobre a
  //    janela [início, hoje] — crédito de venda antiga pode ter caído ontem.
  const recebiveisPagaveis = await db
    .select({
      id: schema.recebivelAdquirente.id,
      nsu: schema.recebivelAdquirente.nsu,
      dataPagamento: schema.recebivelAdquirente.dataPagamento,
      valorLiquido: schema.recebivelAdquirente.valorLiquido,
      formaPagamento: schema.recebivelAdquirente.formaPagamento,
    })
    .from(schema.recebivelAdquirente)
    .where(
      and(
        eq(schema.recebivelAdquirente.filialId, filialId),
        eq(schema.recebivelAdquirente.adquirente, ADQUIRENTE_CIELO),
        gte(schema.recebivelAdquirente.dataPagamento, dataInicio),
        lte(schema.recebivelAdquirente.dataPagamento, hoje),
      ),
    );
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
        lte(schema.lancamentoBanco.dataMovimento, hoje),
      ),
    );

  const resultadoBanco = matchCieloBanco(
    recebiveisPagaveis
      .filter((r) => Number(r.valorLiquido) > 0)
      .map((r) => ({
        id: r.id,
        nsu: r.nsu,
        dataPagamento: isoParaBr(r.dataPagamento),
        formaPagamento: /pix/i.test(r.formaPagamento ?? '') ? 'Pix' : (r.formaPagamento ?? ''),
        valorLiquido: Number(r.valorLiquido),
      })),
    lancamentos.map((l) => ({
      id: l.id,
      dataMovimento: isoParaBr(l.dataMovimento),
      tipo: l.tipo as 'C' | 'D',
      valor: Number(l.valor),
      descricao: l.descricao ?? '',
      idTransacao: l.idTransacao ?? '',
    })),
  );
  const { nsusPagos } = resultadoBanco;
  // Lançamentos que quitaram cada grupo (dia+tipo) — viram lancamentos_banco_ids.
  const lancsPorGrupo = new Map<string, string[]>();
  for (const g of resultadoBanco.gruposCompletos) {
    lancsPorGrupo.set(
      `${g.dataPagamento}|${g.tipo}`,
      g.lancamentosBanco.map((l) => l.id).filter(Boolean) as string[],
    );
  }

  // 5. Rebaixa etapa dos "COMPLETO" provisórios seguindo a cadeia e monta upserts.
  const rows: Array<typeof schema.conciliacaoPagamento.$inferInsert> = [];
  const resumo: BaixaResumo = {
    total: { qtd: 0, valor: 0 },
    porEtapa: {
      COMPLETO: { qtd: 0, valor: 0 },
      NAO_NA_CIELO_VENDA: { qtd: 0, valor: 0 },
      SEM_AGENDA_RECEBIVEL: { qtd: 0, valor: 0 },
      NAO_PAGO_NO_BANCO: { qtd: 0, valor: 0 },
      DIVERGENCIA_VALOR: { qtd: 0, valor: 0 },
    },
    aguardandoCredito: { qtd: 0, valor: 0 },
    aceitos: { qtd: 0, valor: 0 },
  };

  for (const c of porPagamento.values()) {
    let recebivelId: string | null = null;
    let lancamentosIds: string[] | null = null;
    let aguardando = false;
    let previsto: string | null = null;

    if (c.vendaId && (c.etapa === 'COMPLETO' || c.aceito)) {
      const v = vendaPorId.get(c.vendaId);
      const rec = v ? recPorNsuData.get(`${v.nsu}|${v.dataVenda}`) : undefined;
      if (!rec) {
        c.etapa = 'SEM_AGENDA_RECEBIVEL';
      } else {
        recebivelId = rec.id;
        previsto = rec.dataPagamento;
        if (nsusPagos.has(rec.nsu)) {
          c.etapa = 'COMPLETO';
          const tipo = /pix/i.test(rec.formaPagamento ?? '') ? 'PIX' : 'CARTAO';
          lancamentosIds = lancsPorGrupo.get(`${isoParaBr(rec.dataPagamento)}|${tipo}`) ?? null;
        } else {
          c.etapa = 'NAO_PAGO_NO_BANCO';
          aguardando = rec.dataPagamento > hoje;
        }
      }
    }

    rows.push({
      pagamentoId: c.pagamentoId,
      filialId,
      etapa: c.etapa,
      vendaAdquirenteId: c.vendaId,
      recebivelAdquirenteId: recebivelId,
      lancamentosBancoIds: lancamentosIds,
      valorDivergencia: c.divergencia != null ? c.divergencia.toFixed(2) : null,
      detalhes: {
        aceito: c.aceito || undefined,
        aguardandoCredito: aguardando || undefined,
        creditoPrevisto: previsto ?? undefined,
      },
      rodadoEm: new Date(),
    });

    resumo.total.qtd++;
    resumo.total.valor += c.valor;
    resumo.porEtapa[c.etapa].qtd++;
    resumo.porEtapa[c.etapa].valor += c.valor;
    if (aguardando) {
      resumo.aguardandoCredito.qtd++;
      resumo.aguardandoCredito.valor += c.valor;
    }
    if (c.aceito && c.etapa !== 'COMPLETO') {
      resumo.aceitos.qtd++;
      resumo.aceitos.valor += c.valor;
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db
      .insert(schema.conciliacaoPagamento)
      .values(chunk)
      .onConflictDoUpdate({
        target: [schema.conciliacaoPagamento.pagamentoId],
        set: {
          etapa: sql`excluded.etapa`,
          vendaAdquirenteId: sql`excluded.venda_adquirente_id`,
          recebivelAdquirenteId: sql`excluded.recebivel_adquirente_id`,
          lancamentosBancoIds: sql`excluded.lancamentos_banco_ids`,
          valorDivergencia: sql`excluded.valor_divergencia`,
          detalhes: sql`excluded.detalhes`,
          rodadoEm: sql`excluded.rodado_em`,
        },
      });
  }

  return resumo;
}

/** Roda a cadeia inteira (3 engines) + materializa a baixa. */
export async function rodarConciliacaoAutomatica(opts: {
  filialId: string;
  dataInicio: string; // YYYY-MM-DD
  dataFim: string;
}): Promise<AutomaticaResultado> {
  const operadora = await rodarConciliacaoOperadora(opts);
  const recebiveis = await rodarConciliacaoRecebiveis(opts);
  const banco = await rodarConciliacaoBanco(opts);
  const baixa = await materializarBaixa(opts);
  return { operadora, recebiveis, banco, baixa };
}
