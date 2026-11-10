// POST /api/rh/estudo-equipe/analise — recalcula o estudo do mês e pede a
// análise da IA; guarda em rh_estudo_equipe (uma linha por casa e mês).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, lt, isNotNull, desc } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { hojeBr } from '@/lib/datas';
import { montarEstudoEquipe } from '@/lib/rh/estudo-equipe';
import { analisarEstudoComIa } from '@/lib/rh/estudo-equipe-ia';

export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await exigirPermApi('folha_equipe.read');
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as {
    filialId?: string;
    mes?: string;
    meta?: number;
    metaCoz?: number;
    min?: number;
  };
  const filiais = await filiaisDoUsuario(auth.user.id);
  const filial = filiais.find((f) => f.id === body.filialId);
  if (!filial) return NextResponse.json({ erro: 'Casa sem acesso' }, { status: 403 });
  if (!body.mes || !/^\d{4}-\d{2}$/.test(body.mes)) return NextResponse.json({ erro: 'Mês inválido' }, { status: 400 });

  const estudo = await montarEstudoEquipe(filial.id, body.mes, hojeBr(), {
    metaAtend: Number(body.meta) || null,
    metaCoz: Number(body.metaCoz) || null,
    minAtend: Number(body.min) || null,
  });
  if (!estudo) return NextResponse.json({ erro: 'Mês sem ponto próprio nesta casa' }, { status: 400 });

  const anteriores = await db
    .select({ mes: schema.rhEstudoEquipe.competencia, decisao: schema.rhEstudoEquipe.decisao })
    .from(schema.rhEstudoEquipe)
    .where(
      and(
        eq(schema.rhEstudoEquipe.filialId, filial.id),
        lt(schema.rhEstudoEquipe.competencia, body.mes),
        isNotNull(schema.rhEstudoEquipe.decisao),
      ),
    )
    .orderBy(desc(schema.rhEstudoEquipe.competencia))
    .limit(3);

  let analise: string;
  try {
    analise = await analisarEstudoComIa(
      estudo,
      filial.nome,
      anteriores.filter((a): a is { mes: string; decisao: string } => !!a.decisao),
    );
  } catch (e) {
    return NextResponse.json({ erro: `Não consegui a análise da IA: ${(e as Error).message}` }, { status: 502 });
  }

  const agora = new Date();
  await db
    .insert(schema.rhEstudoEquipe)
    .values({
      filialId: filial.id,
      competencia: body.mes,
      dados: { resumo: estudo.resumo, metas: estudo.metas, achados: estudo.achados },
      analise,
      analiseEm: agora,
      analisePor: auth.user.email ?? auth.user.id,
    })
    .onConflictDoUpdate({
      target: [schema.rhEstudoEquipe.filialId, schema.rhEstudoEquipe.competencia],
      set: {
        dados: { resumo: estudo.resumo, metas: estudo.metas, achados: estudo.achados },
        analise,
        analiseEm: agora,
        analisePor: auth.user.email ?? auth.user.id,
      },
    });
  return NextResponse.json({ ok: true, analise, analiseEm: agora.toISOString() });
}
