// GET /api/app/filiais?empresa=<codigo> — BOOTSTRAP do app da maquininha.
//
// A pessoa digita só o CÓDIGO DA EMPRESA (ex.: 'prainha') no login do app; o
// Concilia devolve as filiais dessa organização com a URL pública (túnel) de
// cada uma. O app escolhe a filial e nunca mais digita 'https://win-xxxx…'.
// Serve pra revenda: cada empresa tem seu código no MESMO Concilia.
//
// PÚBLICA (sem login do Concilia — a maquininha não tem sessão web). O que
// sai daqui já é público por natureza (o túnel é internet aberta) e o app
// ainda exige login+PIN na loja. Mesmo assim: só nome + URL, nada mais;
// código inválido = 404 sem dica; e a URL só vem se a filial tiver túnel.
import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNotNull } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('empresa') ?? '';
  const codigo = raw.trim().toLowerCase();
  if (!/^[a-z0-9-]{3,30}$/.test(codigo)) {
    return NextResponse.json({ ok: false, erro: 'código inválido' }, { status: 400 });
  }
  const [org] = await db
    .select({ id: schema.organizacao.id, nome: schema.organizacao.nome })
    .from(schema.organizacao)
    .where(eq(schema.organizacao.codigo, codigo))
    .limit(1);
  if (!org) return NextResponse.json({ ok: false, erro: 'empresa não encontrada' }, { status: 404 });

  const filiais = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome, url: schema.filial.caixaUrl })
    .from(schema.filial)
    .where(and(eq(schema.filial.organizacaoId, org.id), isNotNull(schema.filial.caixaUrl)))
    .orderBy(schema.filial.nome);

  return NextResponse.json({
    ok: true,
    empresa: org.nome,
    filiais: filiais.map((f) => ({ id: f.id, nome: f.nome, url: String(f.url).replace(/\/+$/, '') })),
  });
}
