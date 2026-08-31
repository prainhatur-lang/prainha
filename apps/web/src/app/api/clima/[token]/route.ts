// POST /api/clima/[token] — grava resposta eNPS anônima via token da
// filial. Competência SEMPRE decidida aqui (janelaClima), nunca aceita do
// cliente. Sem login. Sem identificador — ver contrato de anonimato em
// packages/db/src/schema/escuta.ts.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';
import { janelaClima } from '@/lib/clima/janela';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'token inválido' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const nota = Number(body?.nota);
  if (!Number.isInteger(nota) || nota < 0 || nota > 10) {
    return NextResponse.json({ error: 'nota deve ser 0 a 10' }, { status: 400 });
  }
  const comentarioRaw = body?.comentario;
  const comentario = typeof comentarioRaw === 'string' ? comentarioRaw.trim().slice(0, 2000) || null : null;

  const [filial] = await db
    .select({ id: schema.filial.id, climaDiasJanela: schema.filial.climaDiasJanela, climaAbertoAte: schema.filial.climaAbertoAte })
    .from(schema.filial)
    .where(eq(schema.filial.climaToken, token))
    .limit(1);
  if (!filial) {
    return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });
  }

  const janela = janelaClima(filial.climaDiasJanela, filial.climaAbertoAte);
  if (!janela.aberto) {
    return NextResponse.json({ error: 'pesquisa fechada no momento' }, { status: 400 });
  }

  await db.insert(schema.climaResposta).values({
    filialId: filial.id,
    competencia: janela.competencia,
    nota,
    comentario,
    criadoEm: hojeBr(),
  });

  return NextResponse.json({ ok: true });
}
