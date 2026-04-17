// Engine de conciliacao: roda o trace ponta-a-ponta para uma filial+periodo
// e persiste resultado em conciliacao_pagamento + excecao.

import { db, schema } from '@concilia/db';
import { traceCadeia } from '@concilia/conciliador/engine';
import { and, eq, gte, lte, inArray } from 'drizzle-orm';

const ADQUIRENTE_CIELO = 'CIELO';

export interface ConciliacaoResultado {
  execucaoId: string;
  totalPagamentos: number;
  porEtapa: Record<string, { qtd: number; valor: number }>;
  excecoesCriadas: number;
}

export async function rodarConciliacao(opts: {
  filialId: string;
  dataInicio: string; // YYYY-MM-DD
  dataFim: string; // YYYY-MM-DD
}): Promise<ConciliacaoResultado> {
  const { filialId, dataFim } = opts;
  let { dataInicio } = opts;

  // 1. Aplica data de corte da filial (se houver)
  const [fil] = await db
    .select({ dataInicioConciliacao: schema.filial.dataInicioConciliacao })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const corte = fil?.dataInicioConciliacao ?? null;
  if (corte && dataInicio < corte) dataInicio = corte;

  // 2. Cria registro de execucao
  const [exec] = await db
    .insert(schema.execucaoConciliacao)
    .values({ filialId, status: 'EM_ANDAMENTO' })
    .returning({ id: schema.execucaoConciliacao.id });
  const execId = exec!.id;

  try {
    // 3. Carrega pagamentos do PDV no periodo
    const dtIni = new Date(dataInicio + 'T00:00:00');
    const dtFim = new Date(dataFim + 'T23:59:59');

    const pagamentos = await db
      .select({
        id: schema.pagamento.id,
        nsu: schema.pagamento.nsuTransacao,
        valor: schema.pagamento.valor,
        formaPagamento: schema.pagamento.formaPagamento,
      })
      .from(schema.pagamento)
      .where(
        and(
          eq(schema.pagamento.filialId, filialId),
          gte(schema.pagamento.dataPagamento, dtIni),
          lte(schema.pagamento.dataPagamento, dtFim),
        ),
      );

    // 4. Carrega vendas e recebiveis do adquirente para o periodo
    const vendas = await db
      .select({
        id: schema.vendaAdquirente.id,
        nsu: schema.vendaAdquirente.nsu,
        valorBruto: schema.vendaAdquirente.valorBruto,
      })
      .from(schema.vendaAdquirente)
      .where(
        and(
          eq(schema.vendaAdquirente.filialId, filialId),
          eq(schema.vendaAdquirente.adquirente, ADQUIRENTE_CIELO),
          gte(schema.vendaAdquirente.dataVenda, dataInicio),
          lte(schema.vendaAdquirente.dataVenda, dataFim),
        ),
      );

    // Recebiveis - busca todos no periodo + ate 60 dias depois (D+30 cartao)
    const dtFimRec = new Date(dtFim);
    dtFimRec.setDate(dtFimRec.getDate() + 60);
    const dataFimRec = dtFimRec.toISOString().slice(0, 10);

    const recebiveis = await db
      .select({
        id: schema.recebivelAdquirente.id,
        nsu: schema.recebivelAdquirente.nsu,
        dataPagamento: schema.recebivelAdquirente.dataPagamento,
        formaPagamento: schema.recebivelAdquirente.formaPagamento,
        valorLiquido: schema.recebivelAdquirente.valorLiquido,
      })
      .from(schema.recebivelAdquirente)
      .where(
        and(
          eq(schema.recebivelAdquirente.filialId, filialId),
          eq(schema.recebivelAdquirente.adquirente, ADQUIRENTE_CIELO),
          gte(schema.recebivelAdquirente.dataPagamento, dataInicio),
          lte(schema.recebivelAdquirente.dataPagamento, dataFimRec),
        ),
      );

    // 5. Lancamentos do banco no mesmo range
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
          lte(schema.lancamentoBanco.dataMovimento, dataFimRec),
        ),
      );

    // Helper para formatar dataPagamento como DD/MM/YYYY (engine usa)
    const isoToBr = (iso: string) => {
      const [y, m, d] = iso.split('-');
      return `${d}/${m}/${y}`;
    };

    // 6. Roda engine
    const trace = traceCadeia({
      pagamentos: pagamentos.map((p) => ({
        id: p.id,
        nsu: p.nsu,
        valor: Number(p.valor),
        formaPagamento: p.formaPagamento ?? '',
      })),
      vendas: vendas.map((v) => ({
        id: v.id,
        nsu: v.nsu,
        valorBruto: Number(v.valorBruto),
      })),
      recebiveis: recebiveis.map((r) => ({
        id: r.id,
        nsu: r.nsu,
        dataPagamento: isoToBr(r.dataPagamento),
        formaPagamento: r.formaPagamento ?? '',
        valorLiquido: Number(r.valorLiquido),
      })),
      lancamentosBanco: lancamentos.map((l) => ({
        id: l.id,
        dataMovimento: isoToBr(l.dataMovimento),
        tipo: l.tipo as 'C' | 'D',
        valor: Number(l.valor),
        descricao: l.descricao ?? '',
        idTransacao: l.idTransacao ?? '',
      })),
    });

    // 7. Persiste resultado por pagamento (upsert) + excecoes
    let excecoesCriadas = 0;
    if (trace.items.length > 0) {
      // Limpa conciliacao_pagamento e excecoes antigas dos pagamentos do periodo
      const pagamentoIds = pagamentos.map((p) => p.id);
      if (pagamentoIds.length) {
        await db
          .delete(schema.excecao)
          .where(inArray(schema.excecao.pagamentoId, pagamentoIds));
        await db
          .delete(schema.conciliacaoPagamento)
          .where(inArray(schema.conciliacaoPagamento.pagamentoId, pagamentoIds));
      }

      // Insere conciliacao
      const concRows = trace.items.map((it) => ({
        pagamentoId: it.pagamento.id,
        filialId,
        etapa: it.etapa,
        vendaAdquirenteId: it.venda?.id ?? null,
        recebivelAdquirenteId: it.recebivel?.id ?? null,
      }));
      await db.insert(schema.conciliacaoPagamento).values(concRows);

      // Cria excecoes
      const excecoes = trace.items
        .filter((it) => it.etapa !== 'COMPLETO')
        .map((it) => ({
          filialId,
          pagamentoId: it.pagamento.id,
          tipo: it.etapa,
          severidade: it.etapa === 'NAO_PAGO_NO_BANCO' ? 'ALTA' : 'MEDIA',
          descricao: descricaoExcecao(it.etapa, it.pagamento, it.venda, it.recebivel),
          valor: String(it.pagamento.valor),
        }));
      if (excecoes.length) {
        await db.insert(schema.excecao).values(excecoes);
        excecoesCriadas = excecoes.length;
      }
    }

    // 8. Atualiza execucao
    const valorTotal = pagamentos.reduce((s, p) => s + Number(p.valor), 0);
    const valorRastreado = trace.items
      .filter((it) => it.etapa === 'COMPLETO')
      .reduce((s, it) => s + it.pagamento.valor, 0);

    await db
      .update(schema.execucaoConciliacao)
      .set({
        finalizadoEm: new Date(),
        status: 'OK',
        resumo: {
          totalPagamentos: trace.items.length,
          completos: trace.resumo.COMPLETO.qtd,
          excecoes: excecoesCriadas,
          valorTotal,
          valorRastreado,
        },
      })
      .where(eq(schema.execucaoConciliacao.id, execId));

    return {
      execucaoId: execId,
      totalPagamentos: trace.items.length,
      porEtapa: trace.resumo,
      excecoesCriadas,
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

function descricaoExcecao(
  etapa: string,
  pagamento: { id: string; valor: number; formaPagamento: string },
  venda: { nsu: string } | null,
  recebivel: { nsu: string } | null,
): string {
  const v = pagamento.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const f = pagamento.formaPagamento || 'sem forma';
  switch (etapa) {
    case 'NAO_NA_CIELO_VENDA':
      return `Pagamento ${v} (${f}) registrado no PDV mas NÃO encontrado nas vendas Cielo. Possível: venda fora do TEF, NSU divergente, arquivo Cielo incompleto.`;
    case 'SEM_AGENDA_RECEBIVEL':
      return `Pagamento ${v} (${f}) está nas vendas Cielo mas SEM agenda de recebimento. Possível: estorno, recusa pós-aprovação, ou arquivo de recebíveis ainda não importado.`;
    case 'NAO_PAGO_NO_BANCO':
      return `Pagamento ${v} (${f}) deveria ter sido depositado pela Cielo mas NÃO foi encontrado no extrato bancário. Verificar se o crédito caiu ou se está em outra conta.`;
    case 'DIVERGENCIA_VALOR':
      return `Valor divergente entre PDV (${v}) e Cielo. Possível: gorjeta, desconto, ou erro de digitação.`;
    default:
      return `Etapa não esperada: ${etapa}`;
  }
}
