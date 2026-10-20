// GET /api/cron/energia-leitura — de hora em hora grava a leitura de cada
// disjuntor/tomada Tuya com medição (tuya_leitura), pra ter consumo e média.
// O contador do disjuntor zera quando falta luz: contador menor que o da
// leitura anterior = queda (zerou) e o consumo da hora é o próprio contador.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { getDeviceStatus, interpretarStatus } from '@/lib/tuya';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Sensores não medem energia — não entram.
const SEM_MEDICAO = ['sensor_porta', 'sensor_presenca', 'sensor_temperatura'];

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dispositivos = await db
    .select()
    .from(schema.tuyaDispositivo)
    .where(and(eq(schema.tuyaDispositivo.ativo, true), notInArray(schema.tuyaDispositivo.tipo, SEM_MEDICAO)));

  const feitos = await Promise.all(
    dispositivos.map(async (d) => {
      try {
        const l = interpretarStatus(await getDeviceStatus(d.tuyaDeviceId), d.codigoSwitch);
        const [anterior] = await db
          .select({ contadorKwh: schema.tuyaLeitura.contadorKwh })
          .from(schema.tuyaLeitura)
          .where(and(eq(schema.tuyaLeitura.dispositivoId, d.id), eq(schema.tuyaLeitura.online, true)))
          .orderBy(desc(schema.tuyaLeitura.lidoEm))
          .limit(1);
        const atual = l.energiaKwh;
        const antes = anterior?.contadorKwh != null ? Number(anterior.contadorKwh) : null;
        const zerou = atual != null && antes != null && atual < antes;
        const consumo = atual == null || antes == null ? null : zerou ? atual : atual - antes;
        await db.insert(schema.tuyaLeitura).values({
          filialId: d.filialId,
          dispositivoId: d.id,
          online: true,
          ligado: l.ligado,
          potenciaW: l.potenciaW?.toFixed(1) ?? null,
          tensaoV: l.tensaoV?.toFixed(1) ?? null,
          correnteA: l.correnteA?.toFixed(3) ?? null,
          contadorKwh: atual?.toFixed(2) ?? null,
          consumoKwh: consumo?.toFixed(3) ?? null,
          zerou,
        });
        return { id: d.id, nome: d.nome, potenciaW: l.potenciaW, consumo, zerou };
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

  return NextResponse.json({ ok: true, feitos });
}
