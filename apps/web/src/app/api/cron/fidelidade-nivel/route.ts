// GET /api/cron/fidelidade-nivel
// Cron diário (03:20 UTC → 00:20 BRT): o nível do Cliente VIP acompanha as
// visitas da janela (ex.: 90 dias). Quando uma visita sai da janela ou a
// categoria garantida do convite vence, o nível pode cair sem ninguém ter
// usado o cartão — e a Wallet só era avisada no uso. Aqui avisa quem mudou
// de ontem pra hoje. Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { diasAtrasBr } from '@/lib/datas';
import { normalizarConfig, type FidelidadeConfig } from '@/lib/fidelidade/config';
import { avisarWallet, tocarPass } from '@/lib/fidelidade/nucleo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const ontem = diasAtrasBr(1);
  const programas = await db
    .select({ filialId: schema.fidelidadePrograma.filialId, config: schema.fidelidadePrograma.config })
    .from(schema.fidelidadePrograma);
  const ids = new Set<string>();
  for (const p of programas) {
    const cfg = normalizarConfig(p.config as Partial<FidelidadeConfig>);
    // a janela de hoje começa em diasAtrasBr(janelaDias - 1): a visita desse
    // dia aqui contava ontem e hoje não conta mais
    const saiu = diasAtrasBr(cfg.janelaDias);
    const cartoes = await db
      .select({ id: schema.fidelidadeCartao.id })
      .from(schema.fidelidadeCartao)
      .where(and(
        eq(schema.fidelidadeCartao.filialId, p.filialId),
        eq(schema.fidelidadeCartao.status, 'ativo'),
        sql`(${schema.fidelidadeCartao.nivelMinimoAte} = ${ontem}::date
          OR EXISTS (SELECT 1 FROM fidelidade_visita v
                      WHERE v.cartao_id = ${schema.fidelidadeCartao.id} AND v.data = ${saiu}::date))`,
      ));
    for (const c of cartoes) ids.add(c.id);
  }
  // cartão que já está na carteira (Apple registrada ou salvo no Google) e
  // ainda não ganhou o código da frente: o aviso faz o celular buscar o pass
  // novo, que já vem com o código. Roda uma vez por cartão — depois que o
  // código nasce, ele sai desta lista.
  const semCodigo = (await db.execute(sql`
    SELECT c.id
      FROM fidelidade_cartao c
     WHERE c.status = 'ativo'
       AND c.codigo_carteira IS NULL
       AND c.aderido_em IS NOT NULL
       AND (c.google_salvo_em IS NOT NULL
            OR EXISTS (SELECT 1 FROM fidelidade_apple_registro r WHERE r.cartao_id = c.id))
  `)) as unknown as Array<{ id: string }>;
  for (const c of semCodigo) ids.add(c.id);
  for (const id of ids) {
    await tocarPass(id);
    await avisarWallet(id);
  }
  if (ids.size) console.log('[fidelidade] nível revisto na Wallet:', ids.size);
  return NextResponse.json({ ok: true, revistos: ids.size });
}
