// POST /api/produtos/[id]/marcas
// Adiciona uma marca como aceita pra esse produto. Cria a marca se nao existir
// na filial. Idempotente — se ja existe vinculo, retorna o existente.
//
// Body: { marca: string }

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: produtoId } = await params;

  let body: { marca?: string };
  try {
    body = (await req.json()) as { marca?: string };
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }

  const nome = (body.marca ?? '').trim();
  if (!nome) return NextResponse.json({ error: 'marca obrigatoria' }, { status: 400 });
  if (nome.length > 100) {
    return NextResponse.json({ error: 'marca muito longa (max 100)' }, { status: 400 });
  }

  // Pega filial do produto
  const [produto] = await db
    .select({ filialId: schema.produto.filialId })
    .from(schema.produto)
    .where(eq(schema.produto.id, produtoId))
    .limit(1);
  if (!produto) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });

  // Acha ou cria marca na filial
  let marcaId: string;
  const [existente] = await db
    .select({ id: schema.marca.id })
    .from(schema.marca)
    .where(and(eq(schema.marca.filialId, produto.filialId), eq(schema.marca.nome, nome)))
    .limit(1);
  if (existente) {
    marcaId = existente.id;
  } else {
    const [novo] = await db
      .insert(schema.marca)
      .values({ filialId: produto.filialId, nome })
      .returning({ id: schema.marca.id });
    marcaId = novo.id;
  }

  // Insere vinculo (idempotente via UNIQUE constraint)
  await db
    .insert(schema.produtoMarcaAceita)
    .values({ filialId: produto.filialId, produtoId, marcaId })
    .onConflictDoNothing({ target: [schema.produtoMarcaAceita.produtoId, schema.produtoMarcaAceita.marcaId] });

  return NextResponse.json({ ok: true, marcaId, marca: nome });
}
