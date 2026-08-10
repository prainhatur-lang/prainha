// POST /api/nfce/testar — testa a config fiscal da filial: abre o certificado
// e consulta o status do serviço NFC-e na SVRS (107 = ok). NÃO exige config
// completa — o ping valida cert+TLS+SVRS; as pendências (ex.: CSC) voltam
// junto como informação, pra tela mostrar o que ainda falta pra EMITIR.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { contextoFiscal, pendenciasConfig } from '@/lib/nfce/emitir';
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

  const [fil] = await db
    .select({ cfg: schema.filial.fiscalConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, parsed.data.filialId))
    .limit(1);
  const pendencias = pendenciasConfig(fil?.cfg);

  const ctxR = await contextoFiscal(parsed.data.filialId, { paraEmitir: false });
  if (!ctxR.ok) {
    return NextResponse.json({ ok: false, erro: ctxR.erro, pendencias });
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
      pendencias,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: `SEFAZ não respondeu: ${(e as Error).message}`, pendencias },
      { status: 502 },
    );
  }
}
