// Helpers para acesso a filiais respeitando RBAC do usuario logado
import { db, schema } from '@concilia/db';
import { and, eq, gte, sql } from 'drizzle-orm';

export interface FilialAcessivel {
  id: string;
  nome: string;
  cnpj: string;
  organizacaoNome: string;
  role: 'DONO' | 'GERENTE';
  ultimoPing: Date | null;
  agenteToken: string;
  /** Data de corte da conciliacao (YYYY-MM-DD). Null = sem corte. */
  dataInicioConciliacao: string | null;
}

/**
 * Retorna as filiais que o usuario enxerga.
 * - role DONO: ve todas da organizacao
 * - role GERENTE: ve apenas as listadas em usuario_filial
 */
export async function filiaisDoUsuario(userId: string): Promise<FilialAcessivel[]> {
  const rows = await db
    .select({
      id: schema.filial.id,
      nome: schema.filial.nome,
      cnpj: schema.filial.cnpj,
      organizacaoNome: schema.organizacao.nome,
      role: schema.usuarioFilial.role,
      ultimoPing: schema.filial.ultimoPing,
      agenteToken: schema.filial.agenteToken,
      dataInicioConciliacao: schema.filial.dataInicioConciliacao,
    })
    .from(schema.usuarioFilial)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.usuarioFilial.filialId))
    .innerJoin(schema.organizacao, eq(schema.organizacao.id, schema.filial.organizacaoId))
    .where(eq(schema.usuarioFilial.usuarioId, userId))
    .orderBy(schema.filial.cnpj);

  return rows as FilialAcessivel[];
}

export interface SyncStats {
  filialId: string;
  ultimaSincronizacao: Date | null;
  ultimoCodigo: number;
  totalSincronizados: number;
  totalPagamentos: number;
  valorTotal: string; // decimal as string
  diasComMovimento: { data: string; qtd: number; valor: string }[];
}

/** Estatisticas de sync de uma filial. */
export async function syncStats(filialId: string): Promise<SyncStats> {
  const [sinc] = await db
    .select({
      ultimaSincronizacao: schema.sincronizacao.ultimaSincronizacao,
      ultimoCodigo: schema.sincronizacao.ultimoCodigoExternoPagamento,
      totalSincronizados: schema.sincronizacao.totalRegistrosSincronizados,
    })
    .from(schema.sincronizacao)
    .where(eq(schema.sincronizacao.filialId, filialId))
    .limit(1);

  const [agg] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      valor: sql<string>`COALESCE(SUM(${schema.pagamento.valor}), 0)::text`,
    })
    .from(schema.pagamento)
    .where(eq(schema.pagamento.filialId, filialId));

  // Ultimos 14 dias por dia
  const desde = new Date();
  desde.setDate(desde.getDate() - 14);
  desde.setHours(0, 0, 0, 0);

  const porDia = await db
    .select({
      data: sql<string>`TO_CHAR(${schema.pagamento.dataPagamento} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`,
      qtd: sql<number>`COUNT(*)::int`,
      valor: sql<string>`COALESCE(SUM(${schema.pagamento.valor}), 0)::text`,
    })
    .from(schema.pagamento)
    .where(
      and(
        eq(schema.pagamento.filialId, filialId),
        gte(schema.pagamento.dataPagamento, desde),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return {
    filialId,
    ultimaSincronizacao: sinc?.ultimaSincronizacao ?? null,
    ultimoCodigo: sinc?.ultimoCodigo ?? 0,
    totalSincronizados: Number(sinc?.totalSincronizados ?? 0),
    totalPagamentos: Number(agg?.total ?? 0),
    valorTotal: String(agg?.valor ?? '0'),
    diasComMovimento: porDia as { data: string; qtd: number; valor: string }[],
  };
}
