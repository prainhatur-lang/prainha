// POST /api/marketing/espelho { filialId, ativo, agora? } — liga/desliga o
// "Instagram → TikTok automático" da casa. Ao ligar, só vale pra post feito
// dali em diante. `agora: true` = roda já pra esta casa (sem esperar o cron).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { acessoMarketingApi } from '@/lib/marketing/acesso';
import { espelharCasa } from '@/lib/marketing/espelho';
import { baseDoApp } from '@/lib/marketing/ligacao';
import { chaveValida } from '@/lib/marketing/chave';
import { temRascunhoTiktok } from '@/lib/marketing/tiktok';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const E = schema.marketingEspelho;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { filialId?: string; ativo?: boolean; agora?: boolean };
  const a = await acessoMarketingApi(b.filialId);
  if (a.error) return a.error;
  const filialId = a.casa.id;

  if (b.agora) {
    const [c] = await db.select().from(E).where(eq(E.filialId, filialId)).limit(1);
    if (!c?.ativo) return NextResponse.json({ error: 'Ligue o automático primeiro.' }, { status: 409 });
    const r = await espelharCasa(filialId, c.desde, baseDoApp(req.url), Date.now() + 240_000);
    return NextResponse.json({ ok: true, enviados: r });
  }

  if (typeof b.ativo !== 'boolean') return NextResponse.json({ error: 'faltou ativo' }, { status: 400 });
  if (b.ativo) {
    const [ig, tt] = await Promise.all([chaveValida(filialId, 'instagram'), chaveValida(filialId, 'tiktok')]);
    if (!ig || !tt) return NextResponse.json({ error: 'Conecte o Instagram e o TikTok desta casa primeiro.' }, { status: 409 });
    if (!temRascunhoTiktok(tt.escopos)) {
      return NextResponse.json(
        { error: 'A ligação do TikTok não tem a permissão video.upload. Clique em Conectar TikTok de novo.' },
        { status: 409 },
      );
    }
  }
  const agora = new Date();
  const [atual] = await db.select().from(E).where(eq(E.filialId, filialId)).limit(1);
  // ligar de novo começa a contar de agora (não manda o que foi postado com ele desligado)
  const desde = b.ativo && !atual?.ativo ? agora : (atual?.desde ?? agora);
  await db
    .insert(E)
    .values({ filialId, ativo: b.ativo, desde, atualizadoPor: a.user.email ?? a.user.id, atualizadoEm: agora })
    .onConflictDoUpdate({
      target: E.filialId,
      set: { ativo: b.ativo, desde, atualizadoPor: a.user.email ?? a.user.id, atualizadoEm: agora },
    });
  return NextResponse.json({ ok: true, ativo: b.ativo, desde: desde.toISOString() });
}
