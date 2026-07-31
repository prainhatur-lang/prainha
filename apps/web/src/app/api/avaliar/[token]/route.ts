// POST /api/avaliar/[token] — grava avaliacao publica via token da filial.
// Chamado pela pagina /avaliar/[token] (sem login; token = autenticacao).
//
// O gating (alta vs baixa) eh re-decidido aqui no server pela filial.notaCorteGoogle,
// nao confia no cliente. So persiste contato (nome/whatsapp) quando nota < corte.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'token inválido' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const nota = Number(body?.nota);
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
    return NextResponse.json({ error: 'nota deve ser 1 a 5' }, { status: 400 });
  }

  const [filial] = await db
    .select({
      id: schema.filial.id,
      googleReviewUrl: schema.filial.googleReviewUrl,
      notaCorteGoogle: schema.filial.notaCorteGoogle,
    })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) {
    return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });
  }

  const alta = nota >= filial.notaCorteGoogle;
  const foiPraGoogle = alta && !!filial.googleReviewUrl;

  // Sanitiza campos. Contato so eh relevante (e so guardamos) em nota baixa.
  const limpar = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t ? t.slice(0, max) : null;
  };
  const nome = alta ? null : limpar(body?.nome, 200);
  const whatsapp = alta
    ? null
    : (() => {
        const so = limpar(body?.whatsapp, 30)?.replace(/\D/g, '') ?? null;
        return so ? so.slice(0, 30) : null;
      })();
  const comentario = limpar(body?.comentario, 2000);
  const origem = limpar(body?.origem, 100);

  await db.insert(schema.avaliacao).values({
    filialId: filial.id,
    nota,
    comentario,
    nome,
    whatsapp,
    origem,
    foiPraGoogle,
    // Altas nascem resolvidas (nao precisam de acao da equipe).
    status: alta ? 'resolvido' : 'novo',
  });

  return NextResponse.json({
    ok: true,
    direcionarGoogle: foiPraGoogle,
    googleUrl: foiPraGoogle ? filial.googleReviewUrl : null,
  });
}
