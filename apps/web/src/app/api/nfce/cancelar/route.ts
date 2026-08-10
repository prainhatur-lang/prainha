// POST /api/nfce/cancelar — cancela uma NFC-e autorizada (evento 110111).
// Sessão + permissão nfce.cancelar. Janela típica: 30 min após autorização
// (quem manda é a SEFAZ — o motivo dela volta pro usuário).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { contextoFiscal } from '@/lib/nfce/emitir';
import { cancelarNfce } from '@/lib/nfce/sefaz';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  id: z.string().uuid(),
  justificativa: z.string().min(15).max(255),
});

const CSTAT_CANCEL_OK = new Set(['135', '136', '155', '573']);

export async function POST(request: Request) {
  const auth = await exigirPermApi('nfce.cancelar');
  if (auth.error) return auth.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, erro: 'body inválido' }, { status: 400 });
  }

  const [nota] = await db
    .select()
    .from(schema.nfceEmitida)
    .where(eq(schema.nfceEmitida.id, parsed.data.id))
    .limit(1);
  if (!nota) return NextResponse.json({ ok: false, erro: 'nota não encontrada' }, { status: 404 });

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, auth.user.id),
        eq(schema.usuarioFilial.filialId, nota.filialId),
      ),
    )
    .limit(1);
  if (!acesso) return NextResponse.json({ ok: false, erro: 'sem acesso à filial' }, { status: 403 });

  if (nota.status !== 'AUTORIZADA' || !nota.protocolo) {
    return NextResponse.json(
      { ok: false, erro: `só nota AUTORIZADA pode ser cancelada (esta está ${nota.status})` },
      { status: 422 },
    );
  }

  const ctxR = await contextoFiscal(nota.filialId);
  if (!ctxR.ok) return NextResponse.json({ ok: false, erro: ctxR.erro }, { status: 422 });

  try {
    const r = await cancelarNfce({
      chave: nota.chave,
      protocolo: nota.protocolo,
      justificativa: parsed.data.justificativa,
      cnpj: ctxR.ctx.cnpj,
      cOrgao: ctxR.ctx.cUF,
      tpAmb: nota.ambiente === 1 ? 1 : 2,
      pem: ctxR.ctx.pem,
    });

    if (!CSTAT_CANCEL_OK.has(r.cStat)) {
      return NextResponse.json(
        { ok: false, erro: `SEFAZ recusou o cancelamento (${r.cStat}): ${r.xMotivo}` },
        { status: 422 },
      );
    }

    await db
      .update(schema.nfceEmitida)
      .set({
        status: 'CANCELADA',
        canceladaEm: new Date(),
        protocoloCancelamento: r.nProt,
        justificativaCancelamento: parsed.data.justificativa,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.nfceEmitida.id, nota.id));

    return NextResponse.json({ ok: true, cStat: r.cStat, protocolo: r.nProt });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: `falha falando com a SEFAZ: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
