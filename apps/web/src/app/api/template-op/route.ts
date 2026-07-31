// GET /api/template-op?filialId=... — lista templates ativos
// POST /api/template-op — cria novo (sem entradas/saídas; user adiciona depois)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function checarAcesso(userId: string, filialId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) return false;
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, userId),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  return !!link;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const filialId = url.searchParams.get('filialId') ?? '';
  const incluirInativos = url.searchParams.get('incluirInativos') === '1';

  if (!(await checarAcesso(user.id, filialId))) {
    return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
  }

  const filtros = [eq(schema.templateOp.filialId, filialId)];
  if (!incluirInativos) filtros.push(eq(schema.templateOp.ativo, true));

  const rows = await db
    .select({
      id: schema.templateOp.id,
      nome: schema.templateOp.nome,
      descricaoPadrao: schema.templateOp.descricaoPadrao,
      vezesUsado: schema.templateOp.vezesUsado,
      ativo: schema.templateOp.ativo,
    })
    .from(schema.templateOp)
    .where(and(...filtros))
    .orderBy(desc(schema.templateOp.vezesUsado), asc(schema.templateOp.nome));

  return NextResponse.json({ templates: rows });
}

const PostBody = z.object({
  filialId: z.string().uuid(),
  nome: z.string().min(1).max(200),
  descricaoPadrao: z.string().max(200).nullable().optional(),
  observacao: z.string().max(1000).nullable().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { filialId, nome, descricaoPadrao, observacao } = parsed.data;

  if (!(await checarAcesso(user.id, filialId))) {
    return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
  }

  try {
    const [tpl] = await db
      .insert(schema.templateOp)
      .values({
        filialId,
        nome: nome.trim(),
        descricaoPadrao: descricaoPadrao ?? null,
        observacao: observacao ?? null,
        criadoPor: user.id,
      })
      .returning({ id: schema.templateOp.id });
    return NextResponse.json({ id: tpl?.id }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message ?? 'erro';
    if (msg.includes('uq_tpl_op_nome')) {
      return NextResponse.json(
        { error: 'ja existe template com esse nome nessa filial' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
