// Conta a pagar paga por Pix da conta do Inter (extrato) → baixa da conta.
//   POST   { itens: [{ pixId, contaId }] } — baixa (pixId = lancamento_banco);
//          conta de outra casa entra também no encontro de contas
//   DELETE { pixId } — desfaz a baixa (e o encontro, enquanto não fechou)
//   PATCH  { pixId, contaId } — "✓ é este Pix": conta já paga à mão, liga a
//          baixa ao Pix pra não trocar mais de casa

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { RecusaTransf } from '@/lib/transferencia';
import { baixarPorPix, confirmarPixDaConta, desfazerBaixaPix } from '@/lib/pix-inter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Baixar = z.object({
  itens: z.array(z.object({ pixId: z.string().uuid(), contaId: z.string().uuid() })).min(1).max(200),
});
const Desfazer = z.object({ pixId: z.string().uuid() });

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  const parsed = Baixar.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  const r = await baixarPorPix({ userId: user.id, itens: parsed.data.itens });
  if (!r.baixados.length && r.recusados.length) {
    return NextResponse.json({ error: r.recusados.map((x) => x.motivo).join('; '), ...r }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...r });
}

export async function DELETE(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  const parsed = Desfazer.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await desfazerBaixaPix(user.id, parsed.data.pixId)) });
  } catch (e) {
    if (e instanceof RecusaTransf) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

const Confirmar = z.object({ pixId: z.string().uuid(), contaId: z.string().uuid() });

export async function PATCH(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  const parsed = Confirmar.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await confirmarPixDaConta(user.id, parsed.data.pixId, parsed.data.contaId)) });
  } catch (e) {
    if (e instanceof RecusaTransf) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
