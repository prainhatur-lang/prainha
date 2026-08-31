// POST /api/metas/[id]/vincular-folha — pega a premiação rateada (congelada
// na avaliação) e insere como folha_ajuste tipo='premiacao' na PRIMEIRA
// folha aberta com data_inicio >= meta.data_fim. A folha nunca recalcula o
// rateio — só lê o que já está congelado.
//
// Mesma régua de permissão de /avaliar (meta.avaliar + folha_equipe.fechar).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, gte } from 'drizzle-orm';
import { exigirPermApi, negarSemPerm } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('meta.avaliar');
  if (error) return error;
  const semPermFolha = await negarSemPerm(user.id, 'folha_equipe.fechar');
  if (semPermFolha) return semPermFolha;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id invalido' }, { status: 400 });

  const [meta] = await db.select().from(schema.metaEquipe).where(eq(schema.metaEquipe.id, id)).limit(1);
  if (!meta) return NextResponse.json({ error: 'meta nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, meta.filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  if (meta.status !== 'avaliada') {
    return NextResponse.json({ error: `meta com status '${meta.status}' não pode ser vinculada` }, { status: 400 });
  }
  if (!meta.bateuMeta) {
    return NextResponse.json({ error: 'meta não foi batida — nada a vincular' }, { status: 400 });
  }

  const rateio = await db.select().from(schema.metaEquipeRateio).where(eq(schema.metaEquipeRateio.metaEquipeId, id));
  if (rateio.length === 0) {
    return NextResponse.json({ error: 'meta batida mas sem rateio gravado (inconsistência) — reabra e avalie de novo' }, { status: 400 });
  }

  const [folha] = await db
    .select()
    .from(schema.folhaSemana)
    .where(and(eq(schema.folhaSemana.filialId, meta.filialId), eq(schema.folhaSemana.status, 'aberta'), gte(schema.folhaSemana.dataInicio, meta.dataFim)))
    .orderBy(asc(schema.folhaSemana.dataInicio))
    .limit(1);
  if (!folha) {
    return NextResponse.json(
      { error: 'nenhuma folha aberta encontrada a partir do fim da competência — abra a folha da semana seguinte primeiro' },
      { status: 400 },
    );
  }

  await db.transaction(async (tx) => {
    await tx.insert(schema.folhaAjuste).values(
      rateio.map((r) => ({
        folhaSemanaId: folha.id,
        fornecedorId: r.fornecedorId,
        tipo: 'premiacao',
        valor: r.valorRateado,
        descricao: `🏆 Premiação — ${meta.nome}`,
        origem: 'meta_premiacao',
        metaEquipeId: meta.id,
      })),
    );
    await tx
      .update(schema.metaEquipe)
      .set({ status: 'vinculada', folhaSemanaVinculadaId: folha.id, vinculadaEm: new Date(), vinculadaPor: user.id, atualizadoEm: new Date() })
      .where(eq(schema.metaEquipe.id, id));
  });

  return NextResponse.json({ ok: true, folhaSemanaId: folha.id, linhas: rateio.length });
}
