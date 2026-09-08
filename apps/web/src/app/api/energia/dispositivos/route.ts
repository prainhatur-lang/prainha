// CRUD do cadastro de dispositivos Tuya por filial (tela /configuracoes/energia).
// Consumo/estado ao vivo ficam em /api/energia/status — aqui é só o mapeamento
// dispositivo Tuya -> filial/tipo/nome.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { asc, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';

const TIPOS = ['entrada', 'saida', 'luz', 'bomba', 'motor', 'outro'] as const;

export async function GET(req: Request) {
  const guard = await exigirPermApi('tuya.read');
  if (guard.error) return guard.error;

  const filialId = new URL(req.url).searchParams.get('filialId');
  if (!filialId) return NextResponse.json({ error: 'filialId obrigatório' }, { status: 400 });

  const dispositivos = await db
    .select()
    .from(schema.tuyaDispositivo)
    .where(eq(schema.tuyaDispositivo.filialId, filialId))
    .orderBy(asc(schema.tuyaDispositivo.tipo), asc(schema.tuyaDispositivo.nome));

  return NextResponse.json({ dispositivos });
}

export async function POST(req: Request) {
  const guard = await exigirPermApi('tuya.configurar');
  if (guard.error) return guard.error;

  const body = await req.json();
  const { filialId, nome, tipo, tuyaDeviceId, codigoSwitch } = body as {
    filialId?: string;
    nome?: string;
    tipo?: string;
    tuyaDeviceId?: string;
    codigoSwitch?: string;
  };

  if (!filialId || !nome?.trim() || !tuyaDeviceId?.trim()) {
    return NextResponse.json({ error: 'filialId, nome e tuyaDeviceId são obrigatórios' }, { status: 400 });
  }
  if (tipo && !TIPOS.includes(tipo as (typeof TIPOS)[number])) {
    return NextResponse.json({ error: `tipo inválido: ${tipo}` }, { status: 400 });
  }

  try {
    const [criado] = await db
      .insert(schema.tuyaDispositivo)
      .values({
        filialId,
        nome: nome.trim(),
        tipo: tipo ?? 'outro',
        tuyaDeviceId: tuyaDeviceId.trim(),
        codigoSwitch: codigoSwitch?.trim() || 'switch_1',
      })
      .returning();
    return NextResponse.json({ dispositivo: criado });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'esse Device ID + código de switch já está cadastrado nessa filial' },
        { status: 409 },
      );
    }
    throw e;
  }
}
