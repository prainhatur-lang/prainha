// Baixa em lote: marca todas as conta_pagar da folha (origem=FOLHA) como
// pagas. Util quando o pagador (banco/contador) confirma que pagou tudo.
// Pula as ja pagas. Retorna quantas baixou.
//
// IMPORTANT: hoje so atualiza o Postgres (cloud). As contas FOLHA ainda nao
// sao espelhadas no Consumer/Firebird (pendente: comando criar_conta_pagar
// no agente). Quando isso for implementado, esse endpoint tambem vai criar
// um comando 'baixar_conta_pagar' por conta.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

const Body = z.object({
  dataPagamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return new NextResponse(`Body inválido: ${(e as Error).message}`, { status: 400 });
  }

  const { id } = await params;
  const [folha] = await db
    .select()
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, id))
    .limit(1);
  if (!folha) return new NextResponse('Folha não encontrada', { status: 404 });

  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, folha.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  if (folha.status !== 'fechada') {
    return new NextResponse('Folha precisa estar fechada antes de baixar', {
      status: 400,
    });
  }

  // valor_pago = valor - COALESCE(descontos, 0) — o que efetivamente foi
  // depositado na conta da pessoa (bruto - fiado/desconto da semana).
  const r = await db
    .update(schema.contaPagar)
    .set({
      dataPagamento: body.dataPagamento,
      valorPago: sql`(${schema.contaPagar.valor} - COALESCE(${schema.contaPagar.descontos}, 0))::numeric(14,2)`,
    })
    .where(
      and(
        eq(schema.contaPagar.folhaSemanaId, id),
        isNull(schema.contaPagar.dataPagamento),
        isNull(schema.contaPagar.dataDelete),
      ),
    )
    .returning({ id: schema.contaPagar.id });

  return NextResponse.json({ ok: true, baixadas: r.length });
}

// DELETE: estorna a baixa em lote — limpa data_pagamento e valor_pago
// das contas FOLHA dessa folha. Permite corrigir caso tenha dado baixa
// errada (ex: data errada, ou pagador na verdade nao pagou).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  const { id } = await params;
  const [folha] = await db
    .select()
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, id))
    .limit(1);
  if (!folha) return new NextResponse('Folha não encontrada', { status: 404 });

  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, folha.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  const r = await db
    .update(schema.contaPagar)
    .set({
      dataPagamento: null,
      valorPago: null,
    })
    .where(
      and(
        eq(schema.contaPagar.folhaSemanaId, id),
        isNull(schema.contaPagar.dataDelete),
      ),
    )
    .returning({ id: schema.contaPagar.id });

  return NextResponse.json({ ok: true, estornadas: r.length });
}
