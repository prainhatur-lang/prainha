// Medição das métricas de meta de equipe. 5 das 6 saem direto de
// dashboardFechamento (zero SQL novo — mesma fonte que a tela de
// Fechamento de mês já usa). avaliacao_media é a única com SELECT próprio.

import { db, schema } from '@concilia/db';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { brDateStart, brDateEnd } from '@/lib/datas';
import { dashboardFechamento } from '@/lib/fechamento-dashboard';

export const METRICAS = ['faturamento', 'faturamento_liquido', 'ticket_medio', 'servico', 'pedidos', 'avaliacao_media'] as const;
export type Metrica = (typeof METRICAS)[number];

export const METRICA_LABEL: Record<Metrica, string> = {
  faturamento: 'Faturamento',
  faturamento_liquido: 'Faturamento líquido',
  ticket_medio: 'Ticket médio',
  servico: 'Serviço (10%)',
  pedidos: 'Pedidos',
  avaliacao_media: 'Avaliação média',
};

/** Mede o valor realizado de uma métrica no mês (ano/mes da competência). */
export async function medirMetrica(filialId: string, metrica: Metrica, ano: number, mes: number): Promise<number> {
  if (metrica === 'avaliacao_media') {
    const mm = String(mes).padStart(2, '0');
    const lastDay = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const tsStart = brDateStart(`${ano}-${mm}-01`);
    const tsEnd = brDateEnd(`${ano}-${mm}-${String(lastDay).padStart(2, '0')}`);
    const [r] = await db
      .select({ media: sql<string>`coalesce(avg(${schema.avaliacao.nota}),0)` })
      .from(schema.avaliacao)
      .where(and(eq(schema.avaliacao.filialId, filialId), gte(schema.avaliacao.criadoEm, tsStart), lte(schema.avaliacao.criadoEm, tsEnd)));
    return Number(r?.media ?? 0);
  }

  const d = await dashboardFechamento(filialId, ano, mes);
  switch (metrica) {
    case 'faturamento': return d.vendas.faturamento;
    case 'faturamento_liquido': return d.vendas.faturamentoLiquido;
    case 'ticket_medio': return d.vendas.ticketMedio;
    case 'servico': return d.vendas.servico;
    case 'pedidos': return d.vendas.pedidos;
  }
}
