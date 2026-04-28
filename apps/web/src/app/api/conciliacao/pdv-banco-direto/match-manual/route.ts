// POST /api/conciliacao/pdv-banco-direto/match-manual
// Body: { pagamentoId, lancamentoBancoId, observacao?, motivo? }
// Cria match firme manual (nivel 1, criado_por=user_id) entre um pagamento
// PDV canal=DIRETO e um credito do banco. Ignora tolerancia (match manual
// e SEMPRE valido — user assumiu a responsabilidade). Util pra resolver
// casos onde diff sai da tolerancia automatica (ex: garcom marcou
// "Pix Manual" mas passou pela maquininha Cielo, gerando diff de 0,49%).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  pagamentoId: z.string().uuid(),
  lancamentoBancoId: z.string().uuid(),
  observacao: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { pagamentoId, lancamentoBancoId, observacao } = parsed.data;

  // RBAC: pagamento e lancamento sao da mesma filial e usuario tem acesso
  const [pag] = await db
    .select({ filialId: schema.pagamento.filialId, valor: schema.pagamento.valor })
    .from(schema.pagamento)
    .where(eq(schema.pagamento.id, pagamentoId))
    .limit(1);
  if (!pag) return NextResponse.json({ error: 'pagamento nao encontrado' }, { status: 404 });

  const [lanc] = await db
    .select({
      contaId: schema.lancamentoBanco.contaBancariaId,
      valor: schema.lancamentoBanco.valor,
    })
    .from(schema.lancamentoBanco)
    .where(eq(schema.lancamentoBanco.id, lancamentoBancoId))
    .limit(1);
  if (!lanc) return NextResponse.json({ error: 'lancamento nao encontrado' }, { status: 404 });

  const [conta] = await db
    .select({ filialId: schema.contaBancaria.filialId })
    .from(schema.contaBancaria)
    .where(eq(schema.contaBancaria.id, lanc.contaId))
    .limit(1);
  if (!conta || conta.filialId !== pag.filialId) {
    return NextResponse.json({ error: 'pag e lancamento de filiais diferentes' }, { status: 400 });
  }

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, pag.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Cria match (1:1 unique em pagamento e lancamento — onConflictDoNothing
  // protege contra double-click e race conditions).
  const diff = +(Number(lanc.valor) - Number(pag.valor)).toFixed(2);
  const obsCompleta = observacao
    ? `Match manual: ${observacao}`
    : 'Match manual.';

  try {
    await db.insert(schema.matchPdvBanco).values({
      filialId: pag.filialId,
      pagamentoId,
      lancamentoBancoId,
      nivelMatch: '1',
      criadoPor: user.id,
      observacao: `${obsCompleta} Diff R$ ${diff.toFixed(2)}.`,
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json(
        { error: 'Pagamento ou lancamento ja casado em outro match.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true, diff });
}
