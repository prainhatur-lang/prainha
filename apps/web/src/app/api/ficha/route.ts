// POST /api/ficha
// Adiciona uma linha de ficha técnica (produto composto -> insumo + quantidade).
// Com `varianteId`, a linha vale só pra aquele TAMANHO (a venda do tamanho baixa
// a receita dele; a receita sem tamanho fica de reserva).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, or } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  produtoId: z.string().uuid(),
  insumoId: z.string().uuid(),
  quantidade: z.number().positive(),
  baixaEstoque: z.boolean().optional(),
  observacao: z.string().max(500).optional(),
  unidade: z.string().max(6).optional(),
  varianteId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { produtoId, insumoId, quantidade, baixaEstoque, observacao, unidade, varianteId } = parsed.data;

  if (produtoId === insumoId) {
    return NextResponse.json({ error: 'produto e insumo nao podem ser iguais' }, { status: 400 });
  }

  const prods = await db
    .select({
      id: schema.produto.id,
      filialId: schema.produto.filialId,
      codigoExterno: schema.produto.codigoExterno,
    })
    .from(schema.produto)
    .where(eq(schema.produto.id, produtoId));
  const [prod] = prods;
  if (!prod) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });

  const [ins] = await db
    .select({ id: schema.produto.id, filialId: schema.produto.filialId })
    .from(schema.produto)
    .where(eq(schema.produto.id, insumoId));
  if (!ins) return NextResponse.json({ error: 'insumo nao encontrado' }, { status: 404 });
  if (ins.filialId !== prod.filialId) {
    return NextResponse.json({ error: 'produto e insumo em filiais diferentes' }, { status: 400 });
  }

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

  // Tamanho tem que ser DESTE produto (o vínculo vem pelo código do Consumer).
  let codigoVariante: number | null = null;
  if (varianteId) {
    const [v] = await db
      .select({ codigo: schema.produtoVariante.codigoExterno })
      .from(schema.produtoVariante)
      .where(
        and(
          eq(schema.produtoVariante.id, varianteId),
          eq(schema.produtoVariante.filialId, prod.filialId),
          isNull(schema.produtoVariante.dataDelete),
          prod.codigoExterno != null
            ? or(
                eq(schema.produtoVariante.produtoId, produtoId),
                eq(schema.produtoVariante.codigoProdutoExterno, prod.codigoExterno),
              )
            : eq(schema.produtoVariante.produtoId, produtoId),
        ),
      )
      .limit(1);
    if (!v) return NextResponse.json({ error: 'tamanho nao pertence a este produto' }, { status: 400 });
    codigoVariante = v.codigo;
  }

  try {
    const [created] = await db
      .insert(schema.fichaTecnica)
      .values({
        filialId: prod.filialId,
        produtoId,
        insumoId,
        quantidade: quantidade.toFixed(4),
        baixaEstoque: baixaEstoque ?? true,
        observacao: observacao ?? null,
        unidade: unidade ?? null,
        varianteId: varianteId ?? null,
        codigoVarianteExterno: codigoVariante,
        origem: 'nuvem',
      })
      .returning({ id: schema.fichaTecnica.id });
    return NextResponse.json({ id: created?.id }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('uq_ficha_prod_insumo') || msg.includes('uq_ficha_var_insumo')) {
      return NextResponse.json(
        { error: varianteId ? 'esse insumo ja esta na receita deste tamanho' : 'esse insumo ja esta na ficha do produto' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
