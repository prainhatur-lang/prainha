// Ar-condicionado pelo aparelho infravermelho Tuya.
// GET  ?filialId=  → aparelhos infravermelhos da casa (tipo sensor_temperatura)
//                    com os controles de ar cadastrados no Smart Life e o estado.
// POST { dispositivoId, remoteId, ligar?, temperatura?, modo?, vento? } → comando.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { comandoAr, estadoAr, listarControlesIr, type ArEstado } from '@/lib/tuya';

export const dynamic = 'force-dynamic';

const AR_CONDICIONADO = 5;
const SEM_ESTADO: ArEstado = { ligado: null, temperatura: null, modo: null, vento: null };

export async function GET(req: Request) {
  const guard = await exigirPermApi('tuya.read');
  if (guard.error) return guard.error;

  const filialId = new URL(req.url).searchParams.get('filialId');
  if (!filialId) return NextResponse.json({ error: 'filialId obrigatório' }, { status: 400 });
  const filiais = await filiaisDoUsuario(guard.user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'sem acesso a essa filial' }, { status: 403 });
  }

  const aparelhos = await db
    .select()
    .from(schema.tuyaDispositivo)
    .where(
      and(
        eq(schema.tuyaDispositivo.filialId, filialId),
        eq(schema.tuyaDispositivo.ativo, true),
        eq(schema.tuyaDispositivo.tipo, 'sensor_temperatura'),
      ),
    );

  const lista = await Promise.all(
    aparelhos.map(async (d) => {
      try {
        const controles = (await listarControlesIr(d.tuyaDeviceId)).filter(
          (c) => Number(c.category_id) === AR_CONDICIONADO,
        );
        const comEstado = await Promise.all(
          controles.map(async (c) => {
            const estado = await estadoAr(d.tuyaDeviceId, c.remote_id).catch(() => SEM_ESTADO);
            return { remoteId: c.remote_id, nome: c.remote_name, marca: c.brand_name ?? null, ...estado };
          }),
        );
        return { dispositivoId: d.id, nome: d.nome, erro: null as string | null, controles: comEstado };
      } catch (e) {
        return { dispositivoId: d.id, nome: d.nome, erro: (e as Error).message, controles: [] };
      }
    }),
  );

  return NextResponse.json({ aparelhos: lista });
}

export async function POST(req: Request) {
  const guard = await exigirPermApi('tuya.control');
  if (guard.error) return guard.error;

  const b = (await req.json()) as {
    dispositivoId?: string;
    remoteId?: string;
    ligar?: boolean;
    temperatura?: number;
    modo?: number;
    vento?: number;
  };
  if (!b.dispositivoId || !b.remoteId || !/^[a-z0-9]{6,40}$/i.test(b.remoteId)) {
    return NextResponse.json({ error: 'dispositivoId e remoteId são obrigatórios' }, { status: 400 });
  }
  const inteiroEntre = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  if (b.temperatura !== undefined && !inteiroEntre(b.temperatura, 16, 30)) {
    return NextResponse.json({ error: 'temperatura entre 16 e 30' }, { status: 400 });
  }
  if (b.modo !== undefined && !inteiroEntre(b.modo, 0, 4)) {
    return NextResponse.json({ error: 'modo inválido' }, { status: 400 });
  }
  if (b.vento !== undefined && !inteiroEntre(b.vento, 0, 3)) {
    return NextResponse.json({ error: 'vento inválido' }, { status: 400 });
  }

  const [dispositivo] = await db
    .select()
    .from(schema.tuyaDispositivo)
    .where(eq(schema.tuyaDispositivo.id, b.dispositivoId));
  if (!dispositivo) return NextResponse.json({ error: 'dispositivo não encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(guard.user.id);
  if (!filiais.some((f) => f.id === dispositivo.filialId)) {
    return NextResponse.json({ error: 'sem acesso a essa filial' }, { status: 403 });
  }

  try {
    const ir = dispositivo.tuyaDeviceId;
    if (typeof b.ligar === 'boolean') await comandoAr(ir, b.remoteId, 'power', b.ligar ? 1 : 0);
    if (b.modo !== undefined) await comandoAr(ir, b.remoteId, 'mode', b.modo);
    if (b.temperatura !== undefined) await comandoAr(ir, b.remoteId, 'temp', b.temperatura);
    if (b.vento !== undefined) await comandoAr(ir, b.remoteId, 'wind', b.vento);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
