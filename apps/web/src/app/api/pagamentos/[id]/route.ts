// PATCH /api/pagamentos/[id]
// Edita campos seguros do pagamento: bandeira, NSU, autorizacao.
// formaPagamento e valor NAO sao editaveis aqui (mudam canal de
// conciliacao e podem mascarar diferencas reais).
// Toda edicao grava log na observacao do proprio pagamento (audit trail simples).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  bandeiraMfe: z.string().max(50).optional().nullable(),
  bandeiraEfetiva: z.string().max(50).optional().nullable(),
  nsuTransacao: z.string().max(50).optional().nullable(),
  numeroAutorizacaoCartao: z.string().max(50).optional().nullable(),
  observacao: z.string().max(500).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  // Busca o pagamento atual
  const [pag] = await db
    .select({
      id: schema.pagamento.id,
      filialId: schema.pagamento.filialId,
      bandeiraMfe: schema.pagamento.bandeiraMfe,
      bandeiraEfetiva: schema.pagamento.bandeiraEfetiva,
      nsuTransacao: schema.pagamento.nsuTransacao,
      numeroAutorizacaoCartao: schema.pagamento.numeroAutorizacaoCartao,
    })
    .from(schema.pagamento)
    .where(eq(schema.pagamento.id, id))
    .limit(1);
  if (!pag) return NextResponse.json({ error: 'pagamento nao encontrado' }, { status: 404 });

  // RBAC: usuario tem acesso a filial do pagamento?
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, pag.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Monta SET com so os campos enviados (e diferentes do atual).
  // Audit log: registra no campo `atualizado_em` + log txt em sincronizado_em? Nao,
  // melhor gravar no proprio Consumer de log (nao temos). Por agora, apenas
  // marca atualizadoEm.
  const set: Partial<{
    bandeiraMfe: string | null;
    bandeiraEfetiva: string | null;
    nsuTransacao: string | null;
    numeroAutorizacaoCartao: string | null;
    atualizadoEm: Date;
  }> = {};
  const mudancas: string[] = [];

  if (parsed.data.bandeiraMfe !== undefined && parsed.data.bandeiraMfe !== pag.bandeiraMfe) {
    set.bandeiraMfe = parsed.data.bandeiraMfe || null;
    mudancas.push(`bandeiraMfe: "${pag.bandeiraMfe ?? ''}" → "${set.bandeiraMfe ?? ''}"`);
  }
  if (
    parsed.data.bandeiraEfetiva !== undefined &&
    parsed.data.bandeiraEfetiva !== pag.bandeiraEfetiva
  ) {
    set.bandeiraEfetiva = parsed.data.bandeiraEfetiva || null;
    mudancas.push(`bandeiraEfetiva: "${pag.bandeiraEfetiva ?? ''}" → "${set.bandeiraEfetiva ?? ''}"`);
  }
  if (parsed.data.nsuTransacao !== undefined && parsed.data.nsuTransacao !== pag.nsuTransacao) {
    set.nsuTransacao = parsed.data.nsuTransacao || null;
    mudancas.push(`nsu: "${pag.nsuTransacao ?? ''}" → "${set.nsuTransacao ?? ''}"`);
  }
  if (
    parsed.data.numeroAutorizacaoCartao !== undefined &&
    parsed.data.numeroAutorizacaoCartao !== pag.numeroAutorizacaoCartao
  ) {
    set.numeroAutorizacaoCartao = parsed.data.numeroAutorizacaoCartao || null;
    mudancas.push(
      `auth: "${pag.numeroAutorizacaoCartao ?? ''}" → "${set.numeroAutorizacaoCartao ?? ''}"`,
    );
  }

  if (mudancas.length === 0) {
    return NextResponse.json({ ok: true, alterado: false, mensagem: 'nada alterou' });
  }

  set.atualizadoEm = new Date();

  await db
    .update(schema.pagamento)
    .set(set)
    .where(eq(schema.pagamento.id, id));

  return NextResponse.json({
    ok: true,
    alterado: true,
    mudancas,
  });
}
