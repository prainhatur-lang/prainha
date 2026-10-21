// POST /api/marketing/{instagram|tiktok}/desconectar { filialId } — apaga as
// chaves da casa (a conta na rede continua igual; só o sistema deixa de ver).

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { apagarLigacaoRede, ehRede } from '@/lib/marketing/ligacao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ rede: string }> }) {
  const { rede } = await ctx.params;
  if (!ehRede(rede)) return NextResponse.json({ error: 'rede desconhecida' }, { status: 400 });
  const { user, error } = await exigirPermApi('atendimento.config');
  if (error) return error;
  const b = (await req.json().catch(() => ({}))) as { filialId?: string };
  const casas = await filiaisDoUsuario(user.id);
  if (!b.filialId || !casas.some((c) => c.id === b.filialId)) {
    return NextResponse.json({ error: 'sem acesso a essa casa' }, { status: 403 });
  }
  await apagarLigacaoRede(b.filialId, rede);
  return NextResponse.json({ ok: true });
}
