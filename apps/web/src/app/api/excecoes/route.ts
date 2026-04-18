// GET /api/excecoes
// Query: filialId?, tipo?, severidade?, dataIni?, dataFim?, page?, pageSize?
// Retorna: { excecoes: [...], total, contagens: [{ tipo, qtd, valor }] }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, gte, lte, inArray, desc, isNull, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Query = z.object({
  filialId: z.string().uuid().optional(),
  processo: z.enum(['OPERADORA', 'RECEBIVEIS', 'BANCO']).optional(),
  tipo: z.string().optional(),
  severidade: z.enum(['ALTA', 'MEDIA', 'BAIXA']).optional(),
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  incluirAceitas: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(0).optional().default(0),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'query invalida', details: parsed.error.flatten() }, { status: 400 });
  }
  const q = parsed.data;

  // RBAC: descobre filiais que o usuario enxerga
  const filiaisAcessiveis = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(eq(schema.usuarioFilial.usuarioId, user.id));
  const idsAcessiveis = filiaisAcessiveis.map((f) => f.filialId);
  if (idsAcessiveis.length === 0) {
    return NextResponse.json({ excecoes: [], total: 0, contagens: [] });
  }

  // Se foi passado filialId, garante que o usuario tem acesso
  let filialFiltro: string[] = idsAcessiveis;
  if (q.filialId) {
    if (!idsAcessiveis.includes(q.filialId)) {
      return NextResponse.json({ error: 'sem acesso a esta filial' }, { status: 403 });
    }
    filialFiltro = [q.filialId];
  }

  // Monta where comum (tudo exceto filtro de tipo — usado pelas contagens)
  const whereBase = [inArray(schema.excecao.filialId, filialFiltro)];
  if (q.processo) whereBase.push(eq(schema.excecao.processo, q.processo));
  if (q.severidade) whereBase.push(eq(schema.excecao.severidade, q.severidade));
  if (q.dataIni) whereBase.push(gte(schema.excecao.detectadoEm, new Date(q.dataIni + 'T00:00:00')));
  if (q.dataFim) whereBase.push(lte(schema.excecao.detectadoEm, new Date(q.dataFim + 'T23:59:59')));
  if (q.incluirAceitas !== 'true') whereBase.push(isNull(schema.excecao.aceitaEm));

  // Contagens por tipo (nao aplica filtro de tipo)
  const contagens = await db
    .select({
      tipo: schema.excecao.tipo,
      qtd: sql<number>`COUNT(*)::int`,
      valor: sql<string>`COALESCE(SUM(${schema.excecao.valor}), 0)::text`,
    })
    .from(schema.excecao)
    .where(and(...whereBase))
    .groupBy(schema.excecao.tipo);

  // Where final pra listagem aplica tambem o tipo
  const whereList = [...whereBase];
  if (q.tipo) whereList.push(eq(schema.excecao.tipo, q.tipo));

  const [totalRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(schema.excecao)
    .where(and(...whereList));
  const total = Number(totalRow?.n ?? 0);

  const excecoes = await db
    .select({
      id: schema.excecao.id,
      filialId: schema.excecao.filialId,
      tipo: schema.excecao.tipo,
      severidade: schema.excecao.severidade,
      descricao: schema.excecao.descricao,
      valor: schema.excecao.valor,
      detectadoEm: schema.excecao.detectadoEm,
      pagamentoId: schema.excecao.pagamentoId,
      pagamentoCodigoExterno: schema.pagamento.codigoExterno,
      pagamentoNsu: schema.pagamento.nsuTransacao,
      pagamentoFormaPagamento: schema.pagamento.formaPagamento,
      pagamentoDataPagamento: schema.pagamento.dataPagamento,
      filialNome: schema.filial.nome,
    })
    .from(schema.excecao)
    .leftJoin(schema.pagamento, eq(schema.pagamento.id, schema.excecao.pagamentoId))
    .innerJoin(schema.filial, eq(schema.filial.id, schema.excecao.filialId))
    .where(and(...whereList))
    .orderBy(desc(schema.excecao.detectadoEm))
    .limit(q.pageSize)
    .offset(q.page * q.pageSize);

  return NextResponse.json({
    excecoes,
    total,
    page: q.page,
    pageSize: q.pageSize,
    contagens: contagens.map((c) => ({ tipo: c.tipo, qtd: Number(c.qtd), valor: Number(c.valor) })),
  });
}
