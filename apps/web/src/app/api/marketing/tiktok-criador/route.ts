// GET /api/marketing/tiktok-criador?filialId= — conta do TikTok e o que ela
// permite agora (quem pode ver, comentário/dueto/stitch, duração máxima).
// A tela Publicar mostra isso antes do post direto, como o TikTok exige.

import { NextResponse } from 'next/server';
import { acessoMarketingApi } from '@/lib/marketing/acesso';
import { chaveValida } from '@/lib/marketing/chave';
import { ErroTiktok, criadorTiktok, temPublicarTiktok } from '@/lib/marketing/tiktok';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const a = await acessoMarketingApi(new URL(req.url).searchParams.get('filialId') ?? undefined);
  if (a.error) return a.error;
  const tt = await chaveValida(a.casa.id, 'tiktok');
  if (!tt) return NextResponse.json({ error: 'O TikTok desta casa não está conectado.' }, { status: 409 });
  if (!temPublicarTiktok(tt.escopos)) {
    return NextResponse.json(
      { error: 'A ligação do TikTok não tem a permissão de publicar direto (video.publish). Conecte o TikTok de novo.' },
      { status: 409 },
    );
  }
  try {
    return NextResponse.json({ criador: await criadorTiktok(tt.accessToken) });
  } catch (e) {
    const msg = e instanceof ErroTiktok ? e.message : 'Não consegui ler a conta do TikTok.';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
