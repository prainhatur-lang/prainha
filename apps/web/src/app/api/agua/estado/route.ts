// GET /api/agua/estado — caixas, bombas e avisos da água (tela /agua).
// GET /api/agua/estado?so=avisar — só os alarmes críticos que pedem aviso em
// tela cheia (consultado por todas as telas via AlertaAguaGlobal).

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { alarmesParaAvisar, carregarEstadoAgua } from '@/lib/agua';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { error } = await exigirPermApi('agua.read');
  if (error) return error;

  if (new URL(req.url).searchParams.get('so') === 'avisar') {
    return NextResponse.json({ alarmes: await alarmesParaAvisar() });
  }
  const estado = await carregarEstadoAgua();
  return NextResponse.json({ instalado: estado !== null, estado });
}
