// /convite/<token> — link do botão do convite de campanha (WhatsApp). Registra
// o toque e leva o cliente pro destino da campanha (site/reserva da casa).
// Público: o token identifica o convidado; token desconhecido só redireciona.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { CAMPANHAS } from '@/lib/campanha';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DESTINO_PADRAO = '/prainhamar';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  // O botão de URL dinâmica da Meta às vezes ANEXA a variável em vez de
  // substituir — chega "{{1}}abc...". Limpa o prefixo {{N}}.
  const token = decodeURIComponent((await params).token).replace(/^\{\{\d+\}\}/, '').trim();
  let destino = DESTINO_PADRAO;
  if (/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    try {
      const [l] = await db
        .select({ id: schema.campanhaConvite.id, campanha: schema.campanhaConvite.campanha })
        .from(schema.campanhaConvite)
        .where(eq(schema.campanhaConvite.token, token))
        .limit(1);
      if (l) {
        destino = CAMPANHAS[l.campanha]?.destino ?? DESTINO_PADRAO;
        await db
          .update(schema.campanhaConvite)
          .set({ clicouEm: sql`now()` })
          .where(and(eq(schema.campanhaConvite.id, l.id), sql`${schema.campanhaConvite.clicouEm} IS NULL`));
      }
    } catch (e) {
      console.error('convite: falha ao registrar o toque', e);
    }
  }
  return NextResponse.redirect(new URL(destino, request.url), 302);
}
