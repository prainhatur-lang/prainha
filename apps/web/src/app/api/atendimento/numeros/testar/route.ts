// POST /api/atendimento/numeros/testar — dispara uma mensagem de TEMPLATE
// (fora da janela de 24h) por um phone_number_id específico. Uso: validar que
// um número cadastrado em whatsapp_numero está de fato enviando mensagem
// (ex.: número novo ainda sem histórico de envio/volume).
//
//  { phoneNumberId, para, template, lang?, params? } -> { ok, waMessageId }

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { enviarTemplate } from '@/lib/atendimento/zap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('atendimento.responder');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const phoneNumberId = typeof b?.phoneNumberId === 'string' ? b.phoneNumberId : '';
  const para = typeof b?.para === 'string' ? b.para.replace(/\D/g, '') : '';
  const template = typeof b?.template === 'string' ? b.template : '';
  const lang = typeof b?.lang === 'string' ? b.lang : 'pt_BR';
  const params: string[] = Array.isArray(b?.params)
    ? b.params.filter((p: unknown): p is string => typeof p === 'string')
    : [];
  if (!phoneNumberId || !para || !template) {
    return NextResponse.json({ error: 'phoneNumberId, para e template obrigatórios' }, { status: 400 });
  }

  const [numero] = await db
    .select({ filialId: schema.whatsappNumero.filialId })
    .from(schema.whatsappNumero)
    .where(eq(schema.whatsappNumero.phoneNumberId, phoneNumberId))
    .limit(1);
  if (!numero) return NextResponse.json({ error: 'phoneNumberId não cadastrado' }, { status: 404 });

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === numero.filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const envio = await enviarTemplate(phoneNumberId, para, template, lang, params);
  if (envio.erro) return NextResponse.json({ error: envio.erro }, { status: 502 });
  return NextResponse.json({ ok: true, waMessageId: envio.waMessageId });
}
