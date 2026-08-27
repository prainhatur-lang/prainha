// POST /api/canal/[token] — grava mensagem anônima da ouvidoria via token
// da filial. Sem login. NUNCA grava IP/user-agent/identificador — ver
// contrato de anonimato em packages/db/src/schema/escuta.ts.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CATEGORIAS = ['assedio', 'seguranca', 'gestao', 'condicoes', 'sugestao', 'outro'];

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'token inválido' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const categoria = typeof body?.categoria === 'string' ? body.categoria : '';
  if (!CATEGORIAS.includes(categoria)) {
    return NextResponse.json({ error: 'categoria inválida' }, { status: 400 });
  }
  const mensagem = typeof body?.mensagem === 'string' ? body.mensagem.trim() : '';
  if (mensagem.length < 10 || mensagem.length > 5000) {
    return NextResponse.json({ error: 'mensagem deve ter entre 10 e 5000 caracteres' }, { status: 400 });
  }

  const [filial] = await db
    .select({ id: schema.filial.id })
    .from(schema.filial)
    .where(eq(schema.filial.ouvidoriaToken, token))
    .limit(1);
  if (!filial) {
    return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });
  }

  await db.insert(schema.ouvidoriaMensagem).values({
    filialId: filial.id,
    categoria,
    mensagem,
    recebidaEm: hojeBr(),
  });

  return NextResponse.json({ ok: true });
}
