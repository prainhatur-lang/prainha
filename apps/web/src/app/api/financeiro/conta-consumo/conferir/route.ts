// POST /api/financeiro/conta-consumo/conferir — confere no Inter as contas de
// consumo pagas pela tela /financeiro/pagar-conta ainda sem desfecho
// (aprovação, agendado, resposta perdida). Pago → baixa; recusado → ERRO.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { resolverCredenciaisInterPagamentos } from '@/lib/inter';
import { sincronizarContasConsumo } from '@/lib/conta-consumo-pagamento';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({ filialId: z.string().uuid() });

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const { filialId } = parsed.data;
  const [acesso] = await db
    .select({ id: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  if (!acesso && !(await ebLiberadaNoFinanceiro(user.id, filialId))) return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });
  const cred = resolverCredenciaisInterPagamentos(filialId);
  if (!cred) return NextResponse.json({ error: 'Esta casa não tem a integração de pagamentos do Inter configurada.' }, { status: 400 });
  const r = await sincronizarContasConsumo(filialId, cred, 45_000);
  return NextResponse.json({ ok: true, ...r });
}
