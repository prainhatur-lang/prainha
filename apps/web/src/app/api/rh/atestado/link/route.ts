// POST /api/rh/atestado/link  { filialId } → link assinado do celular
// (/atestado-celular?f&u&e&s). Quem lança atestado ('ponto.corrigir') na casa.

import { NextResponse } from 'next/server';
import { exigirAlgumaPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { gerarLinkAtestado } from '@/lib/rh/atestado-link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await exigirAlgumaPermApi(['ponto.corrigir', 'ponto.atestado']);
  if (auth.error) return auth.error;
  const { filialId } = (await req.json().catch(() => ({}))) as { filialId?: string };
  if (!filialId || !/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId inválido' }, { status: 400 });
  }
  const filiais = await filiaisDoUsuario(auth.user.id);
  if (!filiais.some((f) => f.id === filialId)) return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });
  const l = gerarLinkAtestado(filialId, auth.user.id);
  if (!l) return NextResponse.json({ error: 'PAGAR_MESA_SECRET não configurada' }, { status: 500 });
  return NextResponse.json({ ok: true, ...l });
}
