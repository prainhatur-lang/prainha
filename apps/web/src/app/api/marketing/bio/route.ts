// POST /api/marketing/bio { filialId, ideia? } → { instagram, tiktok, nome, atual }
// Sugestão de bio do perfil da casa escrita pela IA (só com os fatos da casa).
// Não muda nada na rede: quem cola no app é a casa.

import { NextResponse } from 'next/server';
import { acessoMarketingApi } from '@/lib/marketing/acesso';
import { chaveValida } from '@/lib/marketing/chave';
import { bioInstagram } from '@/lib/marketing/instagram';
import { escreverBios } from '@/lib/marketing/ia';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { filialId?: string; ideia?: string };
  const a = await acessoMarketingApi(b.filialId);
  if (a.error) return a.error;
  let atual = '';
  try {
    const ig = await chaveValida(a.casa.id, 'instagram');
    if (ig) atual = await bioInstagram(ig.accessToken);
  } catch {
    // sem a bio atual: escreve do zero
  }
  try {
    const bios = await escreverBios({ filialId: a.casa.id, casa: a.casa.nome, ideia: String(b.ideia ?? '').slice(0, 500), atual });
    return NextResponse.json({ ...bios, atual });
  } catch (e) {
    return NextResponse.json({ error: `A IA não conseguiu escrever agora: ${(e as Error).message}` }, { status: 502 });
  }
}
