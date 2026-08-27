// Minutos trabalhados por pessoa (fornecedor) num período de datas — lido
// de folha_horas (mesma fonte que paga a folha semanal), filtrado por DIA
// (não por folha_semana_id) pra resolver corretamente semana a cavalo entre
// meses.

import { db, schema } from '@concilia/db';
import { and, eq, gte, lte, sql } from 'drizzle-orm';

export interface PessoaMinutos {
  fornecedorId: string;
  nome: string;
  minutos: number;
}

/** Minutos trabalhados por pessoa ativa da filial, somando folha_horas de
 *  todas as folhas semanais cujo dia caia em [dataInicio, dataFim]. Inclui
 *  só pessoas com fornecedor_folha ativo (mesmo universo do motor de folha). */
export async function minutosPorPessoaNoPeriodo(filialId: string, dataInicio: string, dataFim: string): Promise<PessoaMinutos[]> {
  const pessoas = await db
    .select({ fornecedorId: schema.fornecedorFolha.fornecedorId, nome: schema.fornecedor.nome })
    .from(schema.fornecedorFolha)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.fornecedorFolha.fornecedorId))
    .where(and(eq(schema.fornecedor.filialId, filialId), eq(schema.fornecedorFolha.ativo, true)));

  const horas = await db
    .select({
      fornecedorId: schema.folhaHoras.fornecedorId,
      totalMin: sql<number>`coalesce(sum(${schema.folhaHoras.totalMin}),0)::int`,
    })
    .from(schema.folhaHoras)
    .innerJoin(schema.folhaSemana, eq(schema.folhaHoras.folhaSemanaId, schema.folhaSemana.id))
    .where(
      and(
        eq(schema.folhaSemana.filialId, filialId),
        gte(schema.folhaHoras.dia, dataInicio),
        lte(schema.folhaHoras.dia, dataFim),
      ),
    )
    .groupBy(schema.folhaHoras.fornecedorId);
  const minutosPorFornecedor = new Map(horas.map((h) => [h.fornecedorId, h.totalMin]));

  return pessoas.map((p) => ({
    fornecedorId: p.fornecedorId,
    nome: p.nome ?? '(sem nome)',
    minutos: minutosPorFornecedor.get(p.fornecedorId) ?? 0,
  }));
}
