// Boleto lançado numa casa e pago pelo Inter da outra → encontro de contas.
//   POST   { filialId, dataIni, dataFim, itens: [{ codigo, contaId }] } — lança
//          (filialId = casa dona da conta do Inter que pagou; dataIni/dataFim =
//          período da tela, pra achar o pagamento no banco de novo)
//   DELETE { id } — desfaz (só enquanto o encontro do mês não fechou)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { RecusaTransf } from '@/lib/transferencia';
import { desfazerPagamentoEntreCasas, lancarPagamentosEntreCasas } from '@/lib/pagamento-entre-casas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Lancar = z.object({
  filialId: z.string().uuid(),
  dataIni: ymd,
  dataFim: ymd,
  itens: z.array(z.object({ codigo: z.string().min(1), contaId: z.string().uuid() })).min(1).max(200),
});
const Desfazer = z.object({ id: z.string().uuid() });

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  const parsed = Lancar.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const r = await lancarPagamentosEntreCasas({
      userId: user.id,
      filialPagadoraId: parsed.data.filialId,
      dataIni: parsed.data.dataIni,
      dataFim: parsed.data.dataFim,
      itens: parsed.data.itens,
    });
    if (!r.lancados.length && r.recusados.length) {
      return NextResponse.json({ error: r.recusados.map((x) => x.motivo).join('; '), ...r }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof RecusaTransf) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export async function DELETE(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  const parsed = Desfazer.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await desfazerPagamentoEntreCasas(user.id, parsed.data.id)) });
  } catch (e) {
    if (e instanceof RecusaTransf) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
