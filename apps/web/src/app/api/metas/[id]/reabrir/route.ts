// POST /api/metas/[id]/reabrir — desfaz avaliação/vínculo, volta pra
// status='aberta'. Vinculada: só permite se a folha ainda estiver aberta
// (dinheiro não fechado/pago) — remove os folha_ajuste gerados. Sempre
// remove o rateio congelado (será regerado numa nova avaliação).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
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

  if (meta.status !== 'avaliada' && meta.status !== 'vinculada') {
    return NextResponse.json({ error: `meta com status '${meta.status}' não pode ser reaberta` }, { status: 400 });
  }

  if (meta.status === 'vinculada') {
    if (!meta.folhaSemanaVinculadaId) {
      return NextResponse.json({ error: 'inconsistência: vinculada sem folha_semana_vinculada_id' }, { status: 400 });
    }
    const [folha] = await db.select({ status: schema.folhaSemana.status }).from(schema.folhaSemana).where(eq(schema.folhaSemana.id, meta.folhaSemanaVinculadaId)).limit(1);
    if (!folha || folha.status !== 'aberta') {
      return NextResponse.json({ error: 'a folha vinculada já foi fechada — não é possível reabrir a meta (dinheiro já processado)' }, { status: 400 });
    }
  }

  await db.transaction(async (tx) => {
    if (meta.status === 'vinculada') {
      await tx.delete(schema.folhaAjuste).where(eq(schema.folhaAjuste.metaEquipeId, id));
    }
    await tx.delete(schema.metaEquipeRateio).where(eq(schema.metaEquipeRateio.metaEquipeId, id));
    await tx
      .update(schema.metaEquipe)
      .set({
        status: 'aberta',
        valorRealizado: null,
        bateuMeta: null,
        regraSnapshot: null,
        folhaSemanaVinculadaId: null,
        avaliadaEm: null,
        avaliadaPor: null,
        vinculadaEm: null,
        vinculadaPor: null,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.metaEquipe.id, id));
  });

  return NextResponse.json({ ok: true });
}
