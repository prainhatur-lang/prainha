// GET /api/cron/pix-sistema-conferir — de 5 em 5 min confere no Inter os Pix
// mandados pelo sistema (Pedidos a pagar por Pix) que ainda estão sem
// desfecho — o caso comum é o Pix que pede aprovação no app do Inter: aprovou,
// saiu, e a baixa ficava esperando alguém clicar "Conferir no Inter"
// (27/10/2026). Pago → baixa; recusado → libera as contas. Só chama o banco
// quando há Pix aberto. Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { resolverCredenciaisInterPagamentos } from '@/lib/inter';
import { filiaisComPixAberto, sincronizarPixAbertos } from '@/lib/pix-pagamento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const saida: Record<string, unknown> = {};
  for (const filialId of await filiaisComPixAberto()) {
    const cred = resolverCredenciaisInterPagamentos(filialId);
    if (!cred) continue;
    try {
      saida[filialId] = await sincronizarPixAbertos(filialId, cred, 15_000);
    } catch (e) {
      saida[filialId] = { erro: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json({ ok: true, casas: saida });
}
