// POST /api/ordem-producao/[id]/gerar-link
// Gera (ou recupera) token público pra essa OP. Idempotente: se já tem
// token, retorna o existente.
//
// Token = 32 bytes random base64url = 43 chars. Único globalmente
// (constraint UNIQUE no schema).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const [op] = await db
    .select({
      id: schema.ordemProducao.id,
      filialId: schema.ordemProducao.filialId,
      status: schema.ordemProducao.status,
      tokenPublico: schema.ordemProducao.tokenPublico,
      enviadaEm: schema.ordemProducao.enviadaEm,
    })
    .from(schema.ordemProducao)
    .where(eq(schema.ordemProducao.id, id))
    .limit(1);
  if (!op) return NextResponse.json({ error: 'OP nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, op.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  if (op.status !== 'RASCUNHO') {
    return NextResponse.json(
      { error: `OP ${op.status} — só RASCUNHO pode ser enviada pro cozinheiro` },
      { status: 400 },
    );
  }

  let token = op.tokenPublico;
  if (!token) {
    token = randomBytes(32).toString('base64url');
    await db
      .update(schema.ordemProducao)
      .set({ tokenPublico: token, enviadaEm: new Date() })
      .where(eq(schema.ordemProducao.id, id));
  } else if (!op.enviadaEm) {
    // Token já existe mas nunca foi enviado (raro)
    await db
      .update(schema.ordemProducao)
      .set({ enviadaEm: new Date() })
      .where(eq(schema.ordemProducao.id, id));
  }

  return NextResponse.json({ token });
}
