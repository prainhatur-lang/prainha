// GET /api/cron/agua-alarmes — a cada minuto, confere se a cópia da água está
// em dia (função agua_avaliar_alarmes no banco). Os alarmes de nível, boia e
// bomba são decididos no servidor da loja e chegam por /api/loja/agua; aqui só
// se acusa "cópia desatualizada" quando a loja para de mandar.
// Enquanto a loja nunca mandou nada, a função não faz nada.

import { NextResponse } from 'next/server';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    await db.execute(sql`select agua_avaliar_alarmes()`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[agua] avaliar alarmes falhou', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
