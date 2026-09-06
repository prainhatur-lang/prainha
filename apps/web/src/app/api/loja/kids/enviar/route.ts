// Espaço Kids — a loja manda uma mensagem pro responsável (chamada, irmão
// que entrou, saída) pelo número da casa que ele já respondeu.
//
// POST { f, e, s, codigo, texto, encerrar? }
//   -> { ok, wa_message_id } ou { ok:false, erro }
//
// Exige check-in com zap confirmado (telefone_confirmado). `encerrar:true`
// fecha o check-in (status 'encerrado') MESMO que o envio falhe — a criança
// já saiu, e a Nina precisa voltar a atender esse número.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { validaLojaKids, enviarParaResponsavel } from '@/lib/kids';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400 });
  const filial = await validaLojaKids(b);
  if (!filial) return NextResponse.json({ ok: false, erro: 'assinatura inválida ou expirada' }, { status: 403 });

  const codigo = String(b.codigo || '').trim().toUpperCase();
  const texto = String(b.texto || '').trim().slice(0, 1500);
  const encerrar = b.encerrar === true;
  if (!codigo) return NextResponse.json({ ok: false, erro: 'código obrigatório' }, { status: 400 });
  if (!texto) return NextResponse.json({ ok: false, erro: 'texto obrigatório' }, { status: 400 });

  const [ck] = await db
    .select({
      id: schema.kidsCheckin.id,
      phoneNumberId: schema.kidsCheckin.phoneNumberId,
      telefoneConfirmado: schema.kidsCheckin.telefoneConfirmado,
      status: schema.kidsCheckin.status,
    })
    .from(schema.kidsCheckin)
    .where(and(eq(schema.kidsCheckin.filialId, filial.id), eq(schema.kidsCheckin.codigo, codigo)))
    .limit(1);
  if (!ck) return NextResponse.json({ ok: false, erro: 'check-in não encontrado' }, { status: 404 });

  if (encerrar && ck.status !== 'encerrado') {
    await db
      .update(schema.kidsCheckin)
      .set({ status: 'encerrado', encerradoEm: sql`now()` })
      .where(eq(schema.kidsCheckin.id, ck.id));
  }

  if (!ck.telefoneConfirmado) {
    return NextResponse.json({ ok: false, erro: 'zap ainda não confirmado', encerrado: encerrar });
  }

  const envio = await enviarParaResponsavel(
    { id: ck.id, phoneNumberId: ck.phoneNumberId, telefoneConfirmado: ck.telefoneConfirmado },
    texto,
  );
  if (envio.erro) return NextResponse.json({ ok: false, erro: envio.erro, encerrado: encerrar });
  return NextResponse.json({ ok: true, wa_message_id: envio.waMessageId, encerrado: encerrar });
}
