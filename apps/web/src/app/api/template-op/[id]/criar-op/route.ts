// POST /api/template-op/[id]/criar-op
// Body: { fatorEscala?: number, descricao?: string, responsavel?: string }
//   - fatorEscala: 1 = quantidades originais, 2 = dobra tudo, etc. Default 1.
//   - descricao: sobrescreve descricaoPadrao do template (opcional)
//   - responsavel: nome do cozinheiro
//
// Cria uma OP em RASCUNHO já populada com entradas e saídas escaladas
// pelo fator. Incrementa template.vezesUsado.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  fatorEscala: z.number().positive().max(1000).optional(),
  descricao: z.string().max(200).nullable().optional(),
  responsavel: z.string().max(100).nullable().optional(),
});

export async function POST(
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

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const fator = parsed.data.fatorEscala ?? 1;

  // Carrega template + entradas + saídas (e checa acesso)
  const [tpl] = await db
    .select()
    .from(schema.templateOp)
    .where(eq(schema.templateOp.id, id))
    .limit(1);
  if (!tpl) return NextResponse.json({ error: 'template nao encontrado' }, { status: 404 });
  if (!tpl.ativo) {
    return NextResponse.json({ error: 'template inativo' }, { status: 400 });
  }

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, tpl.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const entradasTpl = await db
    .select()
    .from(schema.templateOpEntrada)
    .where(eq(schema.templateOpEntrada.templateId, id));
  if (entradasTpl.length === 0) {
    return NextResponse.json(
      { error: 'template sem entradas — adicione antes de usar' },
      { status: 400 },
    );
  }

  const saidasTpl = await db
    .select()
    .from(schema.templateOpSaida)
    .where(eq(schema.templateOpSaida.templateId, id));
  if (saidasTpl.length === 0) {
    return NextResponse.json(
      { error: 'template sem saidas — adicione antes de usar' },
      { status: 400 },
    );
  }

  // Cria OP
  const [op] = await db
    .insert(schema.ordemProducao)
    .values({
      filialId: tpl.filialId,
      descricao: (parsed.data.descricao ?? tpl.descricaoPadrao ?? tpl.nome).trim(),
      observacao: tpl.observacao,
      responsavel: parsed.data.responsavel ?? null,
      criadoPor: user.id,
    })
    .returning({ id: schema.ordemProducao.id });

  if (!op) return NextResponse.json({ error: 'falha criando OP' }, { status: 500 });

  // Popula entradas escaladas. Pra cada uma, busca preço atual do produto.
  for (const e of entradasTpl) {
    const [prod] = await db
      .select({ precoCusto: schema.produto.precoCusto })
      .from(schema.produto)
      .where(eq(schema.produto.id, e.produtoId))
      .limit(1);
    const qtd = Number(e.quantidadePadrao) * fator;
    const preco = prod?.precoCusto ? Number(prod.precoCusto) : 0;
    await db.insert(schema.ordemProducaoEntrada).values({
      ordemProducaoId: op.id,
      produtoId: e.produtoId,
      quantidade: qtd.toFixed(4),
      precoUnitario: preco.toFixed(6),
      valorTotal: (qtd * preco).toFixed(2),
    });
  }

  // Popula saídas escaladas
  for (const s of saidasTpl) {
    const qtd = Number(s.quantidadePadrao) * fator;
    await db.insert(schema.ordemProducaoSaida).values({
      ordemProducaoId: op.id,
      tipo: s.tipo,
      produtoId: s.produtoId,
      quantidade: qtd.toFixed(4),
      pesoRelativo: s.pesoRelativo,
      observacao: s.observacao,
    });
  }

  // Incrementa contador de uso do template
  await db
    .update(schema.templateOp)
    .set({ vezesUsado: sql`${schema.templateOp.vezesUsado} + 1` })
    .where(eq(schema.templateOp.id, id));

  return NextResponse.json({ opId: op.id, fatorAplicado: fator });
}
