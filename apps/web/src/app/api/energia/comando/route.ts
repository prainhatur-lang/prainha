// Liga/desliga um dispositivo Tuya (luz, bomba, motor, disjuntor de saída).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ligarDesligar } from '@/lib/tuya';

export async function POST(req: Request) {
  const guard = await exigirPermApi('tuya.control');
  if (guard.error) return guard.error;

  const { dispositivoId, ligar } = (await req.json()) as { dispositivoId?: string; ligar?: boolean };
  if (!dispositivoId || typeof ligar !== 'boolean') {
    return NextResponse.json({ error: 'dispositivoId e ligar são obrigatórios' }, { status: 400 });
  }

  const [dispositivo] = await db
    .select()
    .from(schema.tuyaDispositivo)
    .where(eq(schema.tuyaDispositivo.id, dispositivoId));
  if (!dispositivo) return NextResponse.json({ error: 'dispositivo não encontrado' }, { status: 404 });

  try {
    await ligarDesligar(dispositivo.tuyaDeviceId, dispositivo.codigoSwitch, ligar);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
