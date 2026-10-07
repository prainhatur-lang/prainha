// PUT /api/avaliacoes/config — configura avaliacoes de uma filial:
// link do Google e nota de corte do gating. Requer avaliacao.configurar.
// `avaliacaoDestino` (opcional) escolhe pra onde a nota alta leva o cliente;
// quem não manda o campo não mexe nele.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { DESTINOS_AVALIACAO, type DestinoAvaliacao } from '@/lib/avaliacao-destino';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(request: Request) {
  const { user, error } = await exigirPermApi('avaliacao.configurar');
  if (error) return error;

  const body = await request.json().catch(() => null);
  const filialId = typeof body?.filialId === 'string' ? body.filialId : null;
  if (!filialId) {
    return NextResponse.json({ error: 'filialId obrigatório' }, { status: 400 });
  }

  const corte = Number(body?.notaCorteGoogle);
  if (!Number.isInteger(corte) || corte < 1 || corte > 5) {
    return NextResponse.json({ error: 'corte deve ser 1 a 5' }, { status: 400 });
  }

  const limparUrl = (v: unknown, nome: string): { url: string | null } | { erro: string } => {
    if (typeof v !== 'string' || !v.trim()) return { url: null };
    const u = v.trim();
    if (!/^https?:\/\//i.test(u)) return { erro: `link do ${nome} deve começar com http` };
    return { url: u.slice(0, 1000) };
  };

  const g = limparUrl(body?.googleReviewUrl, 'Google');
  if ('erro' in g) return NextResponse.json({ error: g.erro }, { status: 400 });
  const t = limparUrl(body?.tripadvisorReviewUrl, 'TripAdvisor');
  if ('erro' in t) return NextResponse.json({ error: t.erro }, { status: 400 });
  const googleUrl = g.url;
  const tripadvisorUrl = t.url;

  // Destino da nota alta. Campo ausente = não muda (o formulário antigo não
  // mandava). TripAdvisor como destino sem o link dele não leva a lugar nenhum.
  let destino: DestinoAvaliacao | undefined;
  if (body?.avaliacaoDestino !== undefined) {
    if (!(DESTINOS_AVALIACAO as readonly unknown[]).includes(body.avaliacaoDestino)) {
      return NextResponse.json({ error: 'destino inválido' }, { status: 400 });
    }
    destino = body.avaliacaoDestino as DestinoAvaliacao;
    if (destino === 'tripadvisor' && !tripadvisorUrl) {
      return NextResponse.json(
        { error: 'pra levar o cliente ao TripAdvisor, preencha o link do TripAdvisor' },
        { status: 400 },
      );
    }
  }

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  if (!filialIds.includes(filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  await db
    .update(schema.filial)
    .set({
      googleReviewUrl: googleUrl,
      tripadvisorReviewUrl: tripadvisorUrl,
      notaCorteGoogle: corte,
      ...(destino ? { avaliacaoDestino: destino } : {}),
    })
    .where(and(eq(schema.filial.id, filialId), inArray(schema.filial.id, filialIds)));

  return NextResponse.json({ ok: true });
}
