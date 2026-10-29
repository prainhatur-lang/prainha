// POST /api/marketing/anuncios/desconectar { filialId } — o sistema deixa de ver
// a conta de anúncios da casa (na Meta nada muda).

import { NextResponse } from 'next/server';
import { acessoMarketingApi } from '@/lib/marketing/acesso';
import { apagarLigacaoAnuncios } from '@/lib/marketing/anuncios-ligacao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { filialId?: string };
  const acesso = await acessoMarketingApi(b.filialId);
  if (acesso.error) return acesso.error;
  await apagarLigacaoAnuncios(acesso.casa.id);
  return NextResponse.json({ ok: true });
}
