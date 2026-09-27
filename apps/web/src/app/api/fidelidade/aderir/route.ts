// "Não tenho interesse" no convite do Cliente VIP (público; o token do cartão
// é a autenticação): marca que não quer (não recebe convite de novo).
// Ativar NÃO é aqui — é confirmando o celular pelo WhatsApp (/api/fidelidade/cartao),
// senão quem recebesse o link encaminhado ativaria o cartão de outra pessoa.

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { token?: string; acao?: string } | null;
  const token = String(b?.token || '');
  if (token.length < 16) return Response.json({ erro: 'link inválido' }, { status: 400 });
  const [c] = await db.select().from(schema.fidelidadeCartao).where(eq(schema.fidelidadeCartao.token, token)).limit(1);
  if (!c) return Response.json({ erro: 'cartão não encontrado' }, { status: 404 });
  if (c.status !== 'ativo') return Response.json({ erro: 'cartão bloqueado' }, { status: 409 });

  if (b?.acao === 'recusar') {
    if (!c.aderidoEm) {
      await db.update(schema.fidelidadeCartao).set({ recusadoEm: new Date() }).where(eq(schema.fidelidadeCartao.id, c.id));
    }
    return Response.json({ ok: true });
  }
  return Response.json({ erro: 'ação inválida' }, { status: 400 });
}
