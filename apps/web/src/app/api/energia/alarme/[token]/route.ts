// Webhook público do alarme (ex: UniFi Protect > Alarm Manager > ação
// Webhook). O token na URL é a autenticação — sem login. Aceita GET e POST
// (o Protect deixa escolher o método); o corpo é guardado no gatilho só pra
// conferência.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { dispararGatilho } from '@/lib/alarme-gatilho';
import { armModeLigado, chamarProtect, protectConfigurado, sincronizarAtivo } from '@/lib/alarme-protect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handle(req: Request, token: string) {
  const [gatilho] = await db
    .select()
    .from(schema.alarmeGatilho)
    .where(eq(schema.alarmeGatilho.token, token));
  if (!gatilho) return NextResponse.json({ error: 'not found' }, { status: 404 });
  let payload: unknown = null;
  if (req.method === 'POST') {
    const texto = await req.text().catch(() => '');
    try {
      payload = texto ? JSON.parse(texto) : null;
    } catch {
      payload = { texto: texto.slice(0, 4000) };
    }
  }

  // A automação do Protect fica em Programação "Sempre" (o "Quando Armado"
  // não disparou com o perfil armado — 27/09), então quem filtra é aqui:
  // desarmado no Concilia não liga nada. Se a coluna diz desarmado mas o
  // Protect está armado (armaram pelo app do UniFi), vale o Protect. O teste
  // do próprio Protect (eventId testEventId) passa sempre.
  const teste = JSON.stringify(payload ?? '').includes('testEventId');
  let armado = gatilho.ativo;
  if (!armado && protectConfigurado(gatilho)) {
    const r = await chamarProtect(gatilho, 'status');
    if (r.ok) {
      armado = armModeLigado(r.armMode);
      await sincronizarAtivo(gatilho, r.armMode);
    }
  }
  if (!armado && !teste) {
    await db
      .update(schema.alarmeGatilho)
      .set({ ultimoDisparoEm: new Date(), ultimoResultado: 'ignorado — estava desarmado', ultimoPayload: payload })
      .where(eq(schema.alarmeGatilho.id, gatilho.id));
    return NextResponse.json({ ok: false, motivo: 'desarmado' });
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
