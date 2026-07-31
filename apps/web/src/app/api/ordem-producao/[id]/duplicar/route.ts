// POST /api/ordem-producao/[id]/duplicar — clona uma OP existente.
// Usado quando o gestor quer dividir o trabalho entre 2+ cozinheiros sem
// repetir todo o setup (ex: 1 OP pra Maria + 1 OP pra Joao com a mesma
// receita).
//
// O que clona:
//  - descricao (com sufixo " (cópia)")
//  - observacao
//  - entradas (mesmos produtos + quantidades — gestor ajusta depois)
//  - saidas (PRODUTO + PERDA — mesmas configuracoes; quantidades reais
//    serao preenchidas pelo cozinheiro nesta OP nova)
//
// O que NAO clona (sao state da OP original):
//  - status (sempre RASCUNHO)
//  - responsavel (vazio — gestor preenche)
//  - tokenPublico (gera novo quando enviar pro cozinheiro)
//  - enviadaEm, marcadaProntaEm, concluidaEm
//  - fotos
//  - movimentos de estoque
//  - custos rateados
//
// Body opcional: { responsavel?: string, descricao?: string }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  responsavel: z.string().max(200).nullable().optional(),
  descricao: z.string().max(200).nullable().optional(),
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

  const [original] = await db
    .select({
      id: schema.ordemProducao.id,
      filialId: schema.ordemProducao.filialId,
      descricao: schema.ordemProducao.descricao,
      observacao: schema.ordemProducao.observacao,
    })
    .from(schema.ordemProducao)
    .where(eq(schema.ordemProducao.id, id))
    .limit(1);
  if (!original) {
    return NextResponse.json({ error: 'OP nao encontrada' }, { status: 404 });
  }

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, original.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Carrega entradas e saidas da OP original
  const entradas = await db
    .select({
      produtoId: schema.ordemProducaoEntrada.produtoId,
      quantidade: schema.ordemProducaoEntrada.quantidade,
      precoUnitario: schema.ordemProducaoEntrada.precoUnitario,
      valorTotal: schema.ordemProducaoEntrada.valorTotal,
    })
    .from(schema.ordemProducaoEntrada)
    .where(eq(schema.ordemProducaoEntrada.ordemProducaoId, id));

  const saidas = await db
    .select({
      tipo: schema.ordemProducaoSaida.tipo,
      produtoId: schema.ordemProducaoSaida.produtoId,
      quantidade: schema.ordemProducaoSaida.quantidade,
      pesoRelativo: schema.ordemProducaoSaida.pesoRelativo,
      pesoTotalKg: schema.ordemProducaoSaida.pesoTotalKg,
      observacao: schema.ordemProducaoSaida.observacao,
    })
    .from(schema.ordemProducaoSaida)
    .where(eq(schema.ordemProducaoSaida.ordemProducaoId, id));

  const novaDescricao =
    parsed.data.descricao !== undefined
      ? parsed.data.descricao
      : original.descricao
        ? `${original.descricao} (cópia)`
        : null;

  // Cria a OP nova
  const [novaOp] = await db
    .insert(schema.ordemProducao)
    .values({
      filialId: original.filialId,
      descricao: novaDescricao,
      observacao: original.observacao,
      responsavel: parsed.data.responsavel ?? null,
      status: 'RASCUNHO',
      criadoPor: user.id,
    })
    .returning({ id: schema.ordemProducao.id });

  if (!novaOp) {
    return NextResponse.json({ error: 'falha ao criar OP' }, { status: 500 });
  }

  // Clona entradas
  if (entradas.length > 0) {
    await db.insert(schema.ordemProducaoEntrada).values(
      entradas.map((e) => ({
        ordemProducaoId: novaOp.id,
        produtoId: e.produtoId,
        quantidade: e.quantidade,
        precoUnitario: e.precoUnitario,
        valorTotal: e.valorTotal,
      })),
    );
  }

  // Clona saidas (sem custoRateado/valorTotal — sao calculados ao concluir)
  if (saidas.length > 0) {
    await db.insert(schema.ordemProducaoSaida).values(
      saidas.map((s) => ({
        ordemProducaoId: novaOp.id,
        tipo: s.tipo,
        produtoId: s.produtoId,
        quantidade: s.quantidade,
        pesoRelativo: s.pesoRelativo,
        pesoTotalKg: s.pesoTotalKg,
        observacao: s.observacao,
      })),
    );
  }

  return NextResponse.json({ id: novaOp.id });
}
