// GET /api/cron/temperatura-leitura — de 15 em 15 minutos grava temperatura e
// umidade do ambiente (tuya_leitura.temperatura_c / umidade_pct) de cada
// sensor de temperatura Tuya (aparelho infravermelho), pra ter o histórico.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { getDeviceStatus, interpretarTemperatura } from '@/lib/tuya';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sensores = await db
    .select()
    .from(schema.tuyaDispositivo)
    .where(and(eq(schema.tuyaDispositivo.ativo, true), eq(schema.tuyaDispositivo.tipo, 'sensor_temperatura')));
  const temperaturas = await Promise.all(
    sensores.map(async (d) => {
      try {
        const l = interpretarTemperatura(await getDeviceStatus(d.tuyaDeviceId));
        await db.insert(schema.tuyaLeitura).values({
          filialId: d.filialId,
          dispositivoId: d.id,
          online: true,
          temperaturaC: l.temperaturaC?.toFixed(1) ?? null,
          umidadePct: l.umidadePct?.toFixed(1) ?? null,
        });
        return { id: d.id, nome: d.nome, temperaturaC: l.temperaturaC, umidadePct: l.umidadePct };
      } catch (e) {
        await db.insert(schema.tuyaLeitura).values({
          filialId: d.filialId,
          dispositivoId: d.id,
          online: false,
          erro: (e as Error).message.slice(0, 500),
        });
        return { id: d.id, nome: d.nome, erro: (e as Error).message };
      }
    }),
  );

  return NextResponse.json({ ok: true, temperaturas });
}
