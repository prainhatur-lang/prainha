// Datapoints liga/desliga de um dispositivo Tuya, lidos ao vivo — a tela de
// cadastro mostra as opções pra escolher em vez de digitar o código (já
// cadastraram o NOME do botão no lugar do código e o disjuntor não respondia).

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { getDeviceInfo, getDeviceStatus } from '@/lib/tuya';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const guard = await exigirPermApi('tuya.configurar');
  if (guard.error) return guard.error;

  const deviceId = new URL(req.url).searchParams.get('deviceId')?.trim() ?? '';
  if (!/^[a-z0-9]{10,40}$/i.test(deviceId)) {
    return NextResponse.json({ error: 'Device ID inválido' }, { status: 400 });
  }
  try {
    const [info, status] = await Promise.all([getDeviceInfo(deviceId), getDeviceStatus(deviceId)]);
    const opcoes = status
      .filter((i) => typeof i.value === 'boolean')
      .map((i) => ({ code: i.code, ligado: i.value as boolean }));
    return NextResponse.json({ nome: info.name, produto: info.product_name ?? null, online: info.online, opcoes });
  } catch (e) {
    return NextResponse.json(
      { error: `A Tuya não achou esse dispositivo (${(e as Error).message}). Confira o ID e se a conta do Smart Life está vinculada ao projeto.` },
      { status: 404 },
    );
  }
}
