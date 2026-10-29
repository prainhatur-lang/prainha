// POST /api/marketing/anuncios/campanha { filialId, campanhaId, ativa } — liga ou pausa.

import { NextResponse } from 'next/server';
import { acessoMarketingApi } from '@/lib/marketing/acesso';
import { ligacaoAnuncios } from '@/lib/marketing/anuncios-ligacao';
import { campanhaDaConta, ErroMeta, mudarStatusCampanha } from '@/lib/marketing/meta-ads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { filialId?: string; campanhaId?: string; ativa?: boolean };
  const acesso = await acessoMarketingApi(b.filialId);
  if (acesso.error) return acesso.error;
  const l = await ligacaoAnuncios(acesso.casa.id);
  if (!l?.contaId) return NextResponse.json({ error: 'Casa sem conta de anúncios.' }, { status: 400 });
  if (!b.campanhaId || !/^\d+$/.test(b.campanhaId)) return NextResponse.json({ error: 'campanha?' }, { status: 400 });
  try {
    if (!(await campanhaDaConta(l.accessToken, b.campanhaId, l.contaId)))
      return NextResponse.json({ error: 'Essa campanha não é desta casa.' }, { status: 403 });
    await mudarStatusCampanha(l.accessToken, b.campanhaId, !!b.ativa);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ErroMeta ? e.message : String(e) }, { status: 400 });
  }
}
