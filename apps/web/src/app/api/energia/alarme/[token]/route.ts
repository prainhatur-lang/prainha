// Webhook público do alarme (ex: UniFi Protect > Alarm Manager > ação
// Webhook). O token na URL é a autenticação — sem login. Aceita GET e POST
// (o Protect deixa escolher o método); o corpo é guardado no gatilho só pra
// conferência.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { dispararGatilho } from '@/lib/alarme-gatilho';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handle(req: Request, token: string) {
  const [gatilho] = await db
    .select()
    .from(schema.alarmeGatilho)
    .where(eq(schema.alarmeGatilho.token, token));
  if (!gatilho) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!gatilho.ativo) return NextResponse.json({ ok: false, motivo: 'gatilho desativado' });

  let payload: unknown = null;
  if (req.method === 'POST') {
    const texto = await req.text().catch(() => '');
    try {
      payload = texto ? JSON.parse(texto) : null;
    } catch {
      payload = { texto: texto.slice(0, 4000) };
    }
  }
  const resultado = await dispararGatilho(gatilho, payload);
  return NextResponse.json({ ok: true, resultado });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(req, (await params).token);
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(req, (await params).token);
}
