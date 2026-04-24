// POST /api/notas/distribuicao/consultar
// Body: JSON { filialId, uf?, loop? }
//
// Consulta SEFAZ DF-e pra uma filial. Se loop=true, itera até esgotar NSUs
// (máximo 10 lotes pra não estourar timeout do Vercel = 60s no plano pro).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { consultarEProcessar, type ResumoConsulta } from '@/lib/nfe-distribuicao';

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

  const resultados: ResumoConsulta[] = [];
  try {
    for (let i = 0; i < 10; i++) {
      const r = await consultarEProcessar({ filialId, uf });
      resultados.push(r);
      if (!loop) break;
      if (!r.temMais) break;
      // cStat 138 = docs localizados; qualquer outro a gente para
      if (r.cStat !== '138') break;
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: `erro na consulta SEFAZ: ${(e as Error).message}`,
        resultados,
      },
      { status: 500 },
    );
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
      erros: acc.erros.concat(r.erros),
    }),
    {
      lotes: 0,
      docsRecebidos: 0,
      nfesCompletasInseridas: 0,
      nfesResumoInseridas: 0,
      duplicadas: 0,
      eventosIgnorados: 0,
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
    detalhado: resultados,
  });
}
