// "Salvar no Google Wallet": marca que o cliente foi salvar (a partir daí
// as mudanças de código/nível são empurradas pro Google) e redireciona pro
// link assinado.

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { googleConfigurada, linkSalvarGoogle } from '@/lib/fidelidade/google';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!googleConfigurada()) return new Response('Google Wallet ainda não configurado', { status: 503 });
  const [c] = await db.select().from(schema.fidelidadeCartao).where(eq(schema.fidelidadeCartao.token, token)).limit(1);
  if (!c) return new Response('cartão não encontrado', { status: 404 });
  // sem adesão não tem Wallet: volta pro link, que mostra o convite
  if (!c.aderidoEm) return Response.redirect(new URL(`/cartao/${c.token}`, req.url), 302);
  const url = await linkSalvarGoogle(c);
  await db.update(schema.fidelidadeCartao).set({ googleSalvoEm: new Date() }).where(eq(schema.fidelidadeCartao.id, c.id));
  return Response.redirect(url, 302);
}
