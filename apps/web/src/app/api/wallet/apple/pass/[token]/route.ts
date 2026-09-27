// Baixa o cartão pra Apple Wallet (botão "Adicionar à Apple Wallet" da
// página /cartao/<token>). O token do link é a autorização.

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { appleConfigurada, gerarPkpass } from '@/lib/fidelidade/apple';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!appleConfigurada()) return new Response('Apple Wallet ainda não configurada', { status: 503 });
  const [c] = await db.select().from(schema.fidelidadeCartao).where(eq(schema.fidelidadeCartao.token, token)).limit(1);
  if (!c) return new Response('cartão não encontrado', { status: 404 });
  // sem adesão não tem Wallet: volta pro link, que mostra o convite
  if (!c.aderidoEm) return Response.redirect(new URL(`/cartao/${c.token}`, req.url), 302);
  const pk = await gerarPkpass(c);
  return new Response(new Uint8Array(pk), {
    headers: {
      'content-type': 'application/vnd.apple.pkpass',
      'content-disposition': 'attachment; filename="prainha.pkpass"',
      'last-modified': c.passAtualizadoEm.toUTCString(),
      'cache-control': 'no-store',
    },
  });
}
