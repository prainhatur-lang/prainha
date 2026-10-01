// POST /api/transferencias/[id]/nfe — emite a NF-e (modelo 55) da
// transferência. Opcional: a transferência vale sozinha; a casa que ENVIOU
// pede a nota depois, se quiser. Idempotente (clicar 2x não duplica).
// Body: { homologacao?: boolean } — true força o ambiente de teste da SEFAZ.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { emitirNfeTransferencia } from '@/lib/nfe/emitir';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({ homologacao: z.boolean().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('nota_compra.lancar_estoque');
  if (error) return error;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'body invalido' }, { status: 400 });

  const r = await emitirNfeTransferencia({
    transferenciaId: id,
    userId: user.id,
    homologacao: parsed.data.homologacao === true,
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.erro, cstat: r.cstat, transitorio: r.transitorio === true },
      { status: r.transitorio ? 503 : 400 },
    );
  }
  return NextResponse.json({ ok: true, jaExistia: r.jaExistia, nota: r.nota });
}
