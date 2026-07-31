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
import { eq, isNull } from 'drizzle-orm';
import { consultarEProcessar } from '@/lib/nfe-distribuicao';
import { manifestarPendentes } from '@/lib/nfe-manifestar';
import { findActiveCertForFilial } from '@/lib/certificado-resolver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Estratégia: pra cada FILIAL, verifica se ela tem cert disponivel (proprio
  // ou compartilhado de outra filial da mesma org). Se sim, processa.
  // Isso permite que 1 cert da matriz atenda todas as filiais do mesmo cnpj_raiz.
  const hoje = new Date().toISOString().slice(0, 10);

  // Busca todas as filiais ativas (ignora pausadas — loja fechada)
  const filiais = await db
    .select({
      filialId: schema.filial.id,
      organizacaoId: schema.filial.organizacaoId,
    })
    .from(schema.filial)
    .where(isNull(schema.filial.pausadaEm));

  // Resolve cert pra cada filial e filtra as que tem cert disponivel + nao expirado
  const certs: Array<{ filialId: string; validadeFim: string | null }> = [];
  for (const f of filiais) {
    const resolvido = await findActiveCertForFilial(f.filialId);
    if (!resolvido) continue;
    // Pega validade do cert resolvido
    const [c] = await db
      .select({ validadeFim: schema.certificadoFilial.validadeFim })
      .from(schema.certificadoFilial)
      .where(eq(schema.certificadoFilial.id, resolvido.certId))
      .limit(1);
    certs.push({ filialId: f.filialId, validadeFim: c?.validadeFim ?? null });
  }

  const resultados: Array<{
    filialId: string;
    lotes: number;
    docs: number;
    completas: number;
    resumos: number;
    upgrades: number;
    cancelamentos: number;
    duplicadas: number;
    ciencias: number;
    ciencias_erro: number;
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
        upgrades: 0,
        cancelamentos: 0,
        duplicadas: 0,
        ciencias: 0,
        ciencias_erro: 0,
        erro: 'cert expirado',
      });
      continue;
    }

    let lotes = 0;
    let docs = 0;
    let completas = 0;
    let resumos = 0;
    let upgrades = 0;
    let cancelamentos = 0;
    let duplicadas = 0;
    let ciencias = 0;
    let ciencias_erro = 0;
    let erro: string | undefined;

    try {
      // 1. Consulta DF-e (máximo 4 lotes pra sobrar tempo pra manifestação)
      for (let i = 0; i < 4; i++) {
        const r = await consultarEProcessar({ filialId: c.filialId, uf: 'SE' });
        lotes++;
        docs += r.docsRecebidos;
        completas += r.nfesCompletasInseridas;
        resumos += r.nfesResumoInseridas;
        upgrades += r.nfesUpgradeResumoParaCompleta;
        cancelamentos += r.eventosCancelamentoAplicados;
        duplicadas += r.duplicadas;
        if (!r.temMais || r.cStat !== '138') break;
      }

      // 2. Manifestação automática: dá ciência em todos os resumos
      //    Na próxima execução do cron, a SEFAZ vai devolver os procNFe
      //    completos pra upgrade.
      if (resumos > 0) {
        const m = await manifestarPendentes({ filialId: c.filialId, limite: 50 });
        ciencias = m.chavesManifestadas.length;
        ciencias_erro = m.chavesComErro.length;
      }
    } catch (e) {
      erro = (e as Error).message;
    }

    resultados.push({
      filialId: c.filialId,
      lotes,
      docs,
      completas,
      resumos,
      upgrades,
      cancelamentos,
      duplicadas,
      ciencias,
      ciencias_erro,
      erro,
    });
  }

  return NextResponse.json({
    ok: true,
    executadoEm: new Date().toISOString(),
    totalFiliais: certs.length,
    resultados,
  });
}
