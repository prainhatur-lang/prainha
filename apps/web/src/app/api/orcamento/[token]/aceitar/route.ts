// POST /api/orcamento/[token]/aceitar — aceite formal do orçamento pelo
// cliente (página pública). Registra nome, data/hora e IP. Idempotente:
// o primeiro aceite vale; repetir só retorna o registro.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'token inválido' }, { status: 404 });
  }

  const b = await request.json().catch(() => null);
  const nome =
    typeof b?.nome === 'string' && b.nome.trim() ? b.nome.trim().slice(0, 200) : null;
  if (!nome) return NextResponse.json({ error: 'informe seu nome' }, { status: 400 });

  const [o] = await db
    .select()
    .from(schema.orcamentoEvento)
    .where(eq(schema.orcamentoEvento.aceiteToken, token))
    .limit(1);
  if (!o) return NextResponse.json({ error: 'orçamento não encontrado' }, { status: 404 });

  if (!o.aceiteEm) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) ?? null;
    await db
      .update(schema.orcamentoEvento)
      .set({
        aceiteEm: new Date(),
        aceiteNome: nome,
        aceiteIp: ip,
        status: 'aceito',
        atualizadoEm: sql`now()`,
      })
      .where(eq(schema.orcamentoEvento.id, o.id));
    return NextResponse.json({ ok: true, aceiteNome: nome });
  }

  return NextResponse.json({ ok: true, aceiteNome: o.aceiteNome });
}
