// PATCH /api/produtos/[id]
// Atualiza campos editáveis do produto pela UI: unidadeEstoque, controlaEstoque,
// estoqueMinimo, descontinuado, tipo.
// (nome, preço, etc. vêm do Consumer via agente e não devem ser editados aqui
// pra não gerar conflito na próxima sincronização — exceto em produtos
// criadoNaNuvem, onde o nome é editável.)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UNIDADES = ['un', 'ml', 'g', 'kg', 'l'] as const;
const TIPOS = ['VENDA_SIMPLES', 'INSUMO', 'COMPLEMENTO', 'COMBO', 'VARIANTE', 'SERVICO'] as const;

const Body = z.object({
  nome: z.string().min(1).max(200).trim().optional(),
  unidadeEstoque: z.enum(UNIDADES).optional(),
  controlaEstoque: z.boolean().optional(),
  estoqueMinimo: z.number().min(0).optional(),
  descontinuado: z.boolean().optional(),
  tipo: z.enum(TIPOS).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [prod] = await db
    .select({
      id: schema.produto.id,
      filialId: schema.produto.filialId,
      criadoNaNuvem: schema.produto.criadoNaNuvem,
    })
    .from(schema.produto)
    .where(eq(schema.produto.id, id))
    .limit(1);
  if (!prod) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, prod.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const { nome, unidadeEstoque, controlaEstoque, estoqueMinimo, descontinuado, tipo } = parsed.data;
  const set: Record<string, unknown> = {};
  if (unidadeEstoque !== undefined) set.unidadeEstoque = unidadeEstoque;
  if (controlaEstoque !== undefined) set.controlaEstoque = controlaEstoque;
  if (estoqueMinimo !== undefined) set.estoqueMinimo = estoqueMinimo.toFixed(3);
  if (descontinuado !== undefined) set.descontinuado = descontinuado;
  if (tipo !== undefined) set.tipo = tipo;
  if (nome !== undefined) {
    if (!prod.criadoNaNuvem) {
      return NextResponse.json(
        { error: 'nome de produto do Consumer nao pode ser editado aqui' },
        { status: 400 },
      );
    }
    set.nome = nome;
  }

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  await db.update(schema.produto).set(set).where(eq(schema.produto.id, id));

  return NextResponse.json({ id, ok: true });
}
