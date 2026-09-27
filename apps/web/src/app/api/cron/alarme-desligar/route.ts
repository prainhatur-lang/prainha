// GET /api/cron/alarme-desligar — reverte os gatilhos de alarme com
// desligarAposMin vencido (ex: alarme ligou as luzes às 03:10, apaga às 03:40
// se não disparou de novo).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { aplicarNosDispositivos } from '@/lib/alarme-gatilho';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const vencidos = await db
    .select()
    .from(schema.alarmeGatilho)
    .where(and(isNotNull(schema.alarmeGatilho.reverterEm), lte(schema.alarmeGatilho.reverterEm, new Date())));

  const feitos: Array<{ id: string; resultado: string }> = [];
  for (const g of vencidos) {
    // Zera antes de mandar o comando: se um disparo novo chegar no meio,
    // ele regrava reverterEm e o próximo ciclo cuida.
    const [pego] = await db
      .update(schema.alarmeGatilho)
      .set({ reverterEm: null })
      .where(and(eq(schema.alarmeGatilho.id, g.id), eq(schema.alarmeGatilho.reverterEm, g.reverterEm!)))
      .returning({ id: schema.alarmeGatilho.id });
    if (!pego) continue;
    const resultado = await aplicarNosDispositivos(g, g.acao === 'desligar');
    await db
      .update(schema.alarmeGatilho)
      .set({ ultimoResultado: `auto (${g.desligarAposMin} min): ${resultado}` })
      .where(eq(schema.alarmeGatilho.id, g.id));
    feitos.push({ id: g.id, resultado });
  }
  return NextResponse.json({ ok: true, feitos });
}
