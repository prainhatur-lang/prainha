// GET /api/colaborador?filialId=...&tipo=COZINHA — lista pra autocomplete
// POST /api/colaborador — cria novo (idempotente: se já existe, retorna existente)

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
  const tipo = url.searchParams.get('tipo') ?? 'COZINHA';
  const incluirInativos = url.searchParams.get('incluirInativos') === '1';

  if (!(await checarAcesso(user.id, filialId))) {
    return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
  }

  const filtros = [
    eq(schema.colaborador.filialId, filialId),
    eq(schema.colaborador.tipo, tipo),
  ];
  if (!incluirInativos) {
    filtros.push(eq(schema.colaborador.ativo, true));
  }

  const rows = await db
    .select({
      id: schema.colaborador.id,
      nome: schema.colaborador.nome,
      tipo: schema.colaborador.tipo,
      ativo: schema.colaborador.ativo,
      ultimaAtividadeEm: schema.colaborador.ultimaAtividadeEm,
    })
    .from(schema.colaborador)
    .where(and(...filtros))
    // Mais usados primeiro (recente atividade), depois alfabético
    .orderBy(desc(schema.colaborador.ultimaAtividadeEm), asc(schema.colaborador.nome));

  return NextResponse.json({ colaboradores: rows });
}

const PostBody = z.object({
  filialId: z.string().uuid(),
  nome: z.string().min(1).max(100),
  tipo: z.string().max(20).optional(),
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
  const { filialId, nome, tipo = 'COZINHA' } = parsed.data;

  if (!(await checarAcesso(user.id, filialId))) {
    return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
  }

  const nomeNormalizado = nome.trim();
  if (!nomeNormalizado) {
    return NextResponse.json({ error: 'nome vazio' }, { status: 400 });
  }

  // Idempotente: ON CONFLICT retorna o existente
  const [colab] = await db
    .insert(schema.colaborador)
    .values({
      filialId,
      nome: nomeNormalizado,
      tipo,
      ultimaAtividadeEm: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.colaborador.filialId, schema.colaborador.nome],
      set: {
        ultimaAtividadeEm: new Date(),
        ativo: true, // se estava inativo e voltou a ser usado, reativa
      },
    })
    .returning({
      id: schema.colaborador.id,
      nome: schema.colaborador.nome,
      tipo: schema.colaborador.tipo,
    });

  return NextResponse.json({ colaborador: colab }, { status: 201 });
}
