// POST /api/nfce/inutilizar — inutiliza o número de uma tentativa que nunca
// virou nota (REJEITADA/ERRO). Obrigação fiscal: número pulado tem que ser
// inutilizado até o dia 10 do mês seguinte.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { contextoFiscal } from '@/lib/nfce/emitir';
import { inutilizarNumeracao } from '@/lib/nfce/sefaz';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  id: z.string().uuid(),
  justificativa: z.string().min(15).max(255).default('Numero nao utilizado - falha na emissao'),
});

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

  if (nota.status !== 'REJEITADA' && nota.status !== 'ERRO') {
    return NextResponse.json(
      { ok: false, erro: `só tentativa REJEITADA/ERRO pode ser inutilizada (esta está ${nota.status})` },
      { status: 422 },
    );
  }

  const ctxR = await contextoFiscal(nota.filialId);
  if (!ctxR.ok) return NextResponse.json({ ok: false, erro: ctxR.erro }, { status: 422 });

  try {
    const r = await inutilizarNumeracao({
      cUF: ctxR.ctx.cUF,
      cnpj: ctxR.ctx.cnpj,
      serie: nota.serie,
      numeroInicio: nota.numero,
      numeroFim: nota.numero,
      justificativa: parsed.data.justificativa,
      tpAmb: nota.ambiente === 1 ? 1 : 2,
      pem: ctxR.ctx.pem,
    });

    // 102 = inutilização homologada; 563 = já inutilizado antes (idempotente)
    if (r.cStat !== '102' && r.cStat !== '563') {
      return NextResponse.json(
        { ok: false, erro: `SEFAZ recusou a inutilização (${r.cStat}): ${r.xMotivo}` },
        { status: 422 },
      );
    }

    await db
      .update(schema.nfceEmitida)
      .set({
        status: 'INUTILIZADA',
        cstat: r.cStat,
        xmotivo: r.xMotivo,
        protocolo: r.nProt,
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
