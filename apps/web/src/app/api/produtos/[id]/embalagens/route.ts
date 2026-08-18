// POST /api/produtos/[id]/embalagens — { nome, qtdNaUnidadeEstoque, padrao? }
// Cadastra uma embalagem do produto (caixa 22 kg, balde 15 kg, cx c/ 24 un).
// É o que alimenta o seletor "O preço que você vai dar é de:" do formulário de
// cotação — com a embalagem cadastrada, o fator de conversão sai pronto e o
// fornecedor não responde mais "por kg" quando o pedido é "por caixa".
// GET lista as embalagens do produto.

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const rows = await db
    .select({
      id: schema.produtoEmbalagem.id,
      nome: schema.produtoEmbalagem.nome,
      qtd: schema.produtoEmbalagem.qtdNaUnidadeEstoque,
      padrao: schema.produtoEmbalagem.padrao,
    })
    .from(schema.produtoEmbalagem)
    .where(eq(schema.produtoEmbalagem.produtoId, id));
  return NextResponse.json({ embalagens: rows });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'produto.update');
  if (semPerm) return semPerm;

  const { id } = await params;

  let body: { nome?: string; qtdNaUnidadeEstoque?: number; padrao?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const nome = body.nome?.trim().slice(0, 80);
  const qtd = Number(body.qtdNaUnidadeEstoque);
  if (!nome || !Number.isFinite(qtd) || qtd <= 0) {
    return NextResponse.json({ error: 'nome e qtdNaUnidadeEstoque > 0 obrigatorios' }, { status: 400 });
  }

  const [produto] = await db
    .select({ id: schema.produto.id, filialId: schema.produto.filialId })
    .from(schema.produto)
    .where(eq(schema.produto.id, id))
    .limit(1);
  if (!produto) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });

  // Upsert por (produto, nome): re-cadastrar a mesma embalagem atualiza a qtd
  const [existente] = await db
    .select({ id: schema.produtoEmbalagem.id })
    .from(schema.produtoEmbalagem)
    .where(
      and(
        eq(schema.produtoEmbalagem.produtoId, id),
        eq(schema.produtoEmbalagem.nome, nome),
      ),
    )
    .limit(1);
  if (existente) {
    await db
      .update(schema.produtoEmbalagem)
      .set({ qtdNaUnidadeEstoque: String(qtd), padrao: body.padrao ?? false })
      .where(eq(schema.produtoEmbalagem.id, existente.id));
    return NextResponse.json({ ok: true, id: existente.id, atualizada: true });
  }
  const [nova] = await db
    .insert(schema.produtoEmbalagem)
    .values({
      filialId: produto.filialId,
      produtoId: id,
      nome,
      qtdNaUnidadeEstoque: String(qtd),
      padrao: body.padrao ?? false,
      fonte: 'DONO',
    })
    .returning({ id: schema.produtoEmbalagem.id });
  return NextResponse.json({ ok: true, id: nova!.id, criada: true });
}
