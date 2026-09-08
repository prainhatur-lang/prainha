// Estado ao vivo (liga/desliga + potência/tensão/corrente/energia) de todos
// os dispositivos Tuya cadastrados numa filial. Painel /energia faz polling
// nessa rota.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import {
  getDeviceStatus,
  interpretarStatus,
  interpretarPorta,
  interpretarPresenca,
  interpretarTemperatura,
} from '@/lib/tuya';

export async function GET(req: Request) {
  const guard = await exigirPermApi('tuya.read');
  if (guard.error) return guard.error;

  const filialId = new URL(req.url).searchParams.get('filialId');
  if (!filialId) return NextResponse.json({ error: 'filialId obrigatório' }, { status: 400 });

  const dispositivos = await db
    .select()
    .from(schema.tuyaDispositivo)
    .where(and(eq(schema.tuyaDispositivo.filialId, filialId), eq(schema.tuyaDispositivo.ativo, true)));

  const leituras = await Promise.all(
    dispositivos.map(async (d) => {
      try {
        const items = await getDeviceStatus(d.tuyaDeviceId);
        const leitura =
          d.tipo === 'sensor_porta'
            ? interpretarPorta(items)
            : d.tipo === 'sensor_presenca'
              ? interpretarPresenca(items)
              : d.tipo === 'sensor_temperatura'
                ? interpretarTemperatura(items)
                : interpretarStatus(items, d.codigoSwitch);
        return { id: d.id, ...leitura, online: true, erro: null as string | null };
      } catch (e) {
        return {
          id: d.id,
          ligado: null,
          potenciaW: null,
          tensaoV: null,
          correnteA: null,
          energiaKwh: null,
          portaAberta: null,
          presencaDetectada: null,
          temperaturaC: null,
          umidadePct: null,
          online: false,
          erro: (e as Error).message,
        };
      }
    }),
  );

  return NextResponse.json({ leituras });
}
