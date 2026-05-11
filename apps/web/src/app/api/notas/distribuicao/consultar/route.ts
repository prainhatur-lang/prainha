// POST /api/notas/distribuicao/consultar
// Body: JSON { filialId, uf?, loop? }
//
// Consulta SEFAZ DF-e pra uma filial. Se loop=true, itera até esgotar NSUs
// (máximo 10 lotes pra não estourar timeout do Vercel = 60s no plano pro).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { consultarEProcessar, type ResumoConsulta } from '@/lib/nfe-distribuicao';
import { manifestarPendentes } from '@/lib/nfe-manifestar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    filialId?: string;
    uf?: string;
    loop?: boolean;
    /** 'filial' (default) consulta so a filial passada;
     *  'todas-da-org' consulta todas as filiais da org da filial passada
     *  (util quando o cert e compartilhado) */
    escopo?: 'filial' | 'todas-da-org';
    /** Se true, dispara manifestacao automatica em resumos pendentes
     *  no fim de cada filial consultada. */
    incluirManifestacao?: boolean;
  };
  const filialId = body.filialId;
  if (!filialId || !/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId invalido' }, { status: 400 });
  }

  // RBAC: DONO da filial
  const [link] = await db
    .select({ role: schema.usuarioFilial.role })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!link || link.role !== 'DONO') {
    return NextResponse.json({ error: 'so DONO pode consultar SEFAZ' }, { status: 403 });
  }

  const loop = body.loop !== false; // default: true
  const uf = body.uf ?? 'SE';
  const escopo = body.escopo ?? 'filial';

  // Resolve lista de filiais a processar
  let filiaisIds: string[] = [filialId];
  if (escopo === 'todas-da-org') {
    const [filialAlvo] = await db
      .select({ organizacaoId: schema.filial.organizacaoId })
      .from(schema.filial)
      .where(eq(schema.filial.id, filialId))
      .limit(1);
    if (filialAlvo?.organizacaoId) {
      // Ignora filiais pausadas (loja fechada temporariamente)
      const filiaisDaOrg = await db
        .select({ id: schema.filial.id })
        .from(schema.filial)
        .where(
          and(
            eq(schema.filial.organizacaoId, filialAlvo.organizacaoId),
            isNull(schema.filial.pausadaEm),
          ),
        );
      filiaisIds = filiaisDaOrg.map((f) => f.id);
    }
  }

  const resultados: ResumoConsulta[] = [];
  const erroPorFilial: Array<{ filialId: string; erro: string }> = [];
  let totalManifestadas = 0;

  for (const fId of filiaisIds) {
    try {
      for (let i = 0; i < 10; i++) {
        const r = await consultarEProcessar({ filialId: fId, uf });
        resultados.push(r);
        if (!loop) break;
        if (!r.temMais) break;
        if (r.cStat !== '138') break;
      }
      if (body.incluirManifestacao) {
        try {
          const m = await manifestarPendentes({ filialId: fId, limite: 100 });
          totalManifestadas += m.chavesManifestadas.length;
        } catch (e) {
          erroPorFilial.push({ filialId: fId, erro: `manifestacao: ${(e as Error).message}` });
        }
      }
    } catch (e) {
      erroPorFilial.push({ filialId: fId, erro: (e as Error).message });
    }
  }

  // Consolida
  const consolidado = resultados.reduce(
    (acc, r) => ({
      lotes: acc.lotes + 1,
      docsRecebidos: acc.docsRecebidos + r.docsRecebidos,
      nfesCompletasInseridas: acc.nfesCompletasInseridas + r.nfesCompletasInseridas,
      nfesResumoInseridas: acc.nfesResumoInseridas + r.nfesResumoInseridas,
      duplicadas: acc.duplicadas + r.duplicadas,
      eventosIgnorados: acc.eventosIgnorados + r.eventosIgnorados,
      eventosCancelamentoAplicados:
        acc.eventosCancelamentoAplicados + r.eventosCancelamentoAplicados,
      eventosSemNota: acc.eventosSemNota + r.eventosSemNota,
      erros: acc.erros.concat(r.erros),
    }),
    {
      lotes: 0,
      docsRecebidos: 0,
      nfesCompletasInseridas: 0,
      nfesResumoInseridas: 0,
      duplicadas: 0,
      eventosIgnorados: 0,
      eventosCancelamentoAplicados: 0,
      eventosSemNota: 0,
      erros: [] as string[],
    },
  );

  const ultimo = resultados[resultados.length - 1];

  return NextResponse.json({
    ok: true,
    ...consolidado,
    cStatFinal: ultimo?.cStat ?? null,
    xMotivoFinal: ultimo?.xMotivo ?? null,
    ultNsu: ultimo?.ultNsuDepois ?? null,
    maxNsu: ultimo?.maxNsu ?? null,
    temMais: ultimo?.temMais ?? false,
    lotes: resultados.length,
    filiaisProcessadas: filiaisIds.length,
    totalManifestadas,
    erroPorFilial,
    detalhado: resultados,
  });
}
