// POST /api/nfce/testar — testa a config fiscal da filial: valida pendências,
// abre o certificado e consulta o status do serviço NFC-e na SVRS (107 = ok).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { contextoFiscal } from '@/lib/nfce/emitir';
import { statusServico } from '@/lib/nfce/sefaz';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({ filialId: z.string().uuid() });

export async function POST(request: Request) {
  const auth = await exigirPermApi('configuracao.read');
  if (auth.error) return auth.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'body inválido' }, { status: 400 });

  const ctxR = await contextoFiscal(parsed.data.filialId);
  if (!ctxR.ok) {
    return NextResponse.json({ ok: false, erro: ctxR.erro, pendencias: ctxR.pendencias ?? [] });
  }

  try {
    const st = await statusServico({
      cUF: ctxR.ctx.cUF,
      tpAmb: ctxR.ctx.tpAmb,
      pem: ctxR.ctx.pem,
    });
    const ok = st.cStat === '107';
    return NextResponse.json({
      ok,
      cStat: st.cStat,
      xMotivo: st.xMotivo,
      ambiente: ctxR.ctx.tpAmb === 1 ? 'produção' : 'homologação',
      serie: ctxR.ctx.serie,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: `SEFAZ não respondeu: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
