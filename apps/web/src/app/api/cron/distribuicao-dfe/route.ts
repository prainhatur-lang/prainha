// GET /api/cron/distribuicao-dfe
// Cron diário (07:00 e 19:00 UTC → 04:00 e 16:00 BRT) que consulta SEFAZ DF-e
// pra todas filiais com certificado A1 ativo.
//
// Autenticação:
//  - Vercel Cron envia header `Authorization: Bearer <CRON_SECRET>` automaticamente
//    quando a env var CRON_SECRET está definida.
//  - Rejeita qualquer outro chamador.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { consultarEProcessar } from '@/lib/nfe-distribuicao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Busca todas filiais com cert ativo + não expirado
  const hoje = new Date().toISOString().slice(0, 10);
  const certs = await db
    .select({
      filialId: schema.certificadoFilial.filialId,
      validadeFim: schema.certificadoFilial.validadeFim,
    })
    .from(schema.certificadoFilial)
    .where(eq(schema.certificadoFilial.ativo, true));

  const resultados: Array<{
    filialId: string;
    lotes: number;
    docs: number;
    completas: number;
    resumos: number;
    duplicadas: number;
    erro?: string;
  }> = [];

  for (const c of certs) {
    if (c.validadeFim && c.validadeFim < hoje) {
      resultados.push({
        filialId: c.filialId,
        lotes: 0,
        docs: 0,
        completas: 0,
        resumos: 0,
        duplicadas: 0,
        erro: 'cert expirado',
      });
      continue;
    }

    let lotes = 0;
    let docs = 0;
    let completas = 0;
    let resumos = 0;
    let duplicadas = 0;
    let erro: string | undefined;

    // Máximo 6 lotes por filial por execução (evita estourar 60s)
    try {
      for (let i = 0; i < 6; i++) {
        const r = await consultarEProcessar({ filialId: c.filialId, uf: 'SE' });
        lotes++;
        docs += r.docsRecebidos;
        completas += r.nfesCompletasInseridas;
        resumos += r.nfesResumoInseridas;
        duplicadas += r.duplicadas;
        if (!r.temMais || r.cStat !== '138') break;
      }
    } catch (e) {
      erro = (e as Error).message;
    }

    resultados.push({ filialId: c.filialId, lotes, docs, completas, resumos, duplicadas, erro });
  }

  return NextResponse.json({
    ok: true,
    executadoEm: new Date().toISOString(),
    totalFiliais: certs.length,
    resultados,
  });
}
