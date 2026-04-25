// POST /api/op/[token]/marcar-pronta
// Cozinheiro sinaliza que terminou a OP (não conclui — só notifica gestor).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'token invalido' }, { status: 400 });
  }

  const [op] = await db
    .select({
      id: schema.ordemProducao.id,
      status: schema.ordemProducao.status,
    })
    .from(schema.ordemProducao)
    .where(eq(schema.ordemProducao.tokenPublico, token))
    .limit(1);
  if (!op) return NextResponse.json({ error: 'OP nao encontrada' }, { status: 404 });

  if (op.status !== 'RASCUNHO') {
    return NextResponse.json(
      { error: `OP ${op.status} nao pode ser marcada como pronta` },
      { status: 400 },
    );
  }

  await db
    .update(schema.ordemProducao)
    .set({ marcadaProntaEm: new Date() })
    .where(eq(schema.ordemProducao.id, op.id));

  return NextResponse.json({ ok: true });
}
