// PUT /api/produtos/[id]/receita — { rendimento, itens: [{produtoId, quantidade}], apagarFichaAntiga? }
//
// Receita de um INSUMO feito de insumos (molho, massa, caldo). Mora num
// template de produção cuja saída é este produto — o mesmo que aparece em
// "Templates de produção", então quem edita lá ou aqui mexe na mesma receita.
// Quantidades na unidade de estoque de cada insumo; rendimento na unidade
// deste produto. Produzir = criar OP do template + concluir (a OP baixa os
// ingredientes, entra o insumo e calcula o custo).
//
// apagarFichaAntiga: a ficha técnica de um insumo não baixa nada (ele não é
// vendido) — quem montou a receita ali antes pode migrar e limpar.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  rendimento: z.number().positive().max(10_000_000),
  itens: z
    .array(z.object({ produtoId: z.string().uuid(), quantidade: z.number().positive().max(10_000_000) }))
    .min(1)
    .max(100),
  apagarFichaAntiga: z.boolean().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'produto.update');
  if (semPerm) return semPerm;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  const { rendimento, itens, apagarFichaAntiga } = parsed.data;

  const [prod] = await db
    .select({
      id: schema.produto.id,
      filialId: schema.produto.filialId,
      nome: schema.produto.nome,
      controla: schema.produto.controlaEstoque,
    })
    .from(schema.produto)
    .where(eq(schema.produto.id, id))
    .limit(1);
  if (!prod) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });
  if (!prod.controla) {
    return NextResponse.json(
      { error: 'Ligue "controla estoque" neste produto antes — senão o que for produzido não fica em lugar nenhum.' },
      { status: 400 },
    );
  }

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, prod.filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const ids = [...new Set(itens.map((i) => i.produtoId))];
  if (ids.includes(id)) {
    return NextResponse.json({ error: 'o produto não pode ser ingrediente dele mesmo' }, { status: 400 });
  }
  const ingredientes = await db
    .select({ id: schema.produto.id })
    .from(schema.produto)
    .where(and(inArray(schema.produto.id, ids), eq(schema.produto.filialId, prod.filialId)));
  if (ingredientes.length !== ids.length) {
    return NextResponse.json({ error: 'ingrediente de outra casa ou inexistente' }, { status: 400 });
  }

  const templateId = await db.transaction(async (tx) => {
    // Template que produz este produto (o mais usado, se tiver mais de um).
    const [existente] = await tx
      .select({ id: schema.templateOp.id, saidaId: schema.templateOpSaida.id })
      .from(schema.templateOpSaida)
      .innerJoin(schema.templateOp, eq(schema.templateOp.id, schema.templateOpSaida.templateId))
      .where(
        and(
          eq(schema.templateOpSaida.produtoId, id),
          eq(schema.templateOpSaida.tipo, 'PRODUTO'),
          eq(schema.templateOp.filialId, prod.filialId),
          eq(schema.templateOp.ativo, true),
        ),
      )
      .orderBy(desc(schema.templateOp.vezesUsado))
      .limit(1);

    let tplId: string;
    if (existente) {
      tplId = existente.id;
      await tx
        .update(schema.templateOpSaida)
        .set({ quantidadePadrao: rendimento.toFixed(4) })
        .where(eq(schema.templateOpSaida.id, existente.saidaId));
      await tx.delete(schema.templateOpEntrada).where(eq(schema.templateOpEntrada.templateId, tplId));
      await tx
        .update(schema.templateOp)
        .set({ atualizadoEm: new Date() })
        .where(eq(schema.templateOp.id, tplId));
    } else {
      const base = `Receita: ${prod.nome ?? 'insumo'}`.slice(0, 190);
      const nomesUsados = new Set(
        (
          await tx
            .select({ nome: schema.templateOp.nome })
            .from(schema.templateOp)
            .where(eq(schema.templateOp.filialId, prod.filialId))
        ).map((t) => t.nome),
      );
      let nome = base;
      for (let n = 2; nomesUsados.has(nome); n++) nome = `${base} (${n})`;
      const [tpl] = await tx
        .insert(schema.templateOp)
        .values({ filialId: prod.filialId, nome, descricaoPadrao: nome, criadoPor: user.id })
        .returning({ id: schema.templateOp.id });
      tplId = tpl!.id;
      await tx.insert(schema.templateOpSaida).values({
        templateId: tplId,
        tipo: 'PRODUTO',
        produtoId: id,
        quantidadePadrao: rendimento.toFixed(4),
      });
    }

    // Mesmo ingrediente repetido vira uma linha só.
    const soma = new Map<string, number>();
    for (const i of itens) soma.set(i.produtoId, (soma.get(i.produtoId) ?? 0) + i.quantidade);
    await tx.insert(schema.templateOpEntrada).values(
      [...soma].map(([produtoId, q]) => ({
        templateId: tplId,
        produtoId,
        quantidadePadrao: q.toFixed(4),
      })),
    );

    if (apagarFichaAntiga) {
      await tx.delete(schema.fichaTecnica).where(eq(schema.fichaTecnica.produtoId, id));
    }
    return tplId;
  });

  return NextResponse.json({ ok: true, templateId });
}
