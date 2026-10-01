// POST /api/transferencias/[id]/cancelar — só ABERTA (antes do encontro) e
// sem baixa na conta: devolve o estoque pra origem, tira do destino e apaga a
// conta a pagar do destino. ENVIADA (em trânsito): quem enviou cancela ou quem
// ia receber recusa — só devolve o estoque pra origem.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { cancelarTransferencia, RecusaTransf } from '@/lib/transferencia';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('nota_compra.lancar_estoque');
  if (error) return error;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await cancelarTransferencia({ id, userId: user.id })) });
  } catch (e) {
    if (e instanceof RecusaTransf) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
