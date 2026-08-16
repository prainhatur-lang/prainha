// POST /api/atendimento/interno/perfil — troca a FOTO DE PERFIL do número
// da Nina no WhatsApp (mesma auth por token de filial dos outros /interno/*).
//
//  { token, imageBase64 }  -> { ok }
//
// Fluxo Meta: descobre o app do token (GET /app) → Resumable Upload
// (sessão + binário → handle) → whatsapp_business_profile com o handle.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const VER = process.env.WHATSAPP_API_VERSION || 'v21.0';

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as {
    token?: string;
    imageBase64?: string;
  } | null;
  const token = typeof b?.token === 'string' ? b.token : '';
  const imageBase64 = typeof b?.imageBase64 === 'string' ? b.imageBase64 : '';
  if (token.length < 20 || !imageBase64 || imageBase64.length > 3_000_000) {
    return NextResponse.json({ error: 'payload inválido (máx ~2MB de imagem)' }, { status: 400 });
  }
  const [fil] = await db
    .select({ id: schema.filial.id })
    .from(schema.filial)
    .where(eq(schema.filial.agenteToken, token))
    .limit(1);
  if (!fil) return NextResponse.json({ error: 'token inválido' }, { status: 403 });

  const metaToken = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META;
  if (!metaToken) return NextResponse.json({ error: 'sem token da Meta' }, { status: 500 });
  const [numero] = await db
    .select({ phoneNumberId: schema.whatsappNumero.phoneNumberId })
    .from(schema.whatsappNumero)
    .where(eq(schema.whatsappNumero.filialId, fil.id))
    .limit(1);
  if (!numero) return NextResponse.json({ error: 'filial sem número' }, { status: 400 });

  const img = Buffer.from(imageBase64, 'base64');

  // 1. app do token
  const appResp = await fetch(`https://graph.facebook.com/${VER}/app?access_token=${metaToken}`);
  const app = (await appResp.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null;
  if (!appResp.ok || !app?.id) {
    return NextResponse.json({ error: `app do token: ${app?.error?.message ?? appResp.status}` }, { status: 502 });
  }

  // 2. sessão de upload
  const sess = await fetch(
    `https://graph.facebook.com/${VER}/${app.id}/uploads?file_length=${img.length}&file_type=image/jpeg&access_token=${metaToken}`,
    { method: 'POST' },
  );
  const sessJson = (await sess.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null;
  if (!sess.ok || !sessJson?.id) {
    return NextResponse.json({ error: `sessão upload: ${sessJson?.error?.message ?? sess.status}` }, { status: 502 });
  }

  // 3. binário -> handle
  const up = await fetch(`https://graph.facebook.com/${VER}/${sessJson.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${metaToken}`, file_offset: '0' },
    body: new Uint8Array(img),
  });
  const upJson = (await up.json().catch(() => null)) as { h?: string; error?: { message?: string } } | null;
  if (!up.ok || !upJson?.h) {
    return NextResponse.json({ error: `upload: ${upJson?.error?.message ?? up.status}` }, { status: 502 });
  }

  // 4. aplica no perfil
  const prof = await fetch(
    `https://graph.facebook.com/${VER}/${numero.phoneNumberId}/whatsapp_business_profile`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${metaToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', profile_picture_handle: upJson.h }),
    },
  );
  const profJson = (await prof.json().catch(() => null)) as { success?: boolean; error?: { message?: string } } | null;
  if (!prof.ok || !profJson?.success) {
    return NextResponse.json({ error: `perfil: ${profJson?.error?.message ?? prof.status}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
