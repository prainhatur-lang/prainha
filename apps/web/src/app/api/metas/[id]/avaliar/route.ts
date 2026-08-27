// POST /api/metas/[id]/avaliar — mede a métrica, decide se bateu, e SE
// bateu calcula e grava o rateio (meta_equipe_rateio, imutável). Manual —
// nunca cron (dashboardFechamento tem janela de refetch de 14 dias, cron do
// dia 1 pagaria sobre mês incompleto).
//
// Exige meta.avaliar + folha_equipe.fechar — avaliar cria obrigação
// financeira, mesma régua de fechar a folha.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi, negarSemPerm } from '@/lib/exigir-perm';
import { medirMetrica, type Metrica } from '@/lib/metas/metricas';
import { minutosPorPessoaNoPeriodo } from '@/lib/metas/horas-periodo';
import { ratearPremiacao } from '@/lib/metas/ratear';

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

  if (meta.status !== 'aberta') {
    return NextResponse.json({ error: `meta com status '${meta.status}' não pode ser avaliada de novo — reabra primeiro` }, { status: 400 });
  }

  const [ano, mes] = meta.competencia.split('-').map(Number);
  const valorRealizado = await medirMetrica(meta.filialId, meta.metrica as Metrica, ano, mes);
  const valorAlvo = Number(meta.valorAlvo);
  const bateuMeta = valorRealizado >= valorAlvo;
  const premiacaoTotal = Number(meta.premiacaoTotal);

  const regraSnapshot = { metrica: meta.metrica, valorAlvo, premiacaoTotal, medidoEm: new Date().toISOString() };

  let rateio: Array<{ fornecedorId: string; nome: string; minutos: number; valor: number }> = [];
  if (bateuMeta) {
    const pessoas = await minutosPorPessoaNoPeriodo(meta.filialId, meta.dataInicio, meta.dataFim);
    rateio = ratearPremiacao(pessoas, premiacaoTotal);
  }

  await db.transaction(async (tx) => {
    if (rateio.length > 0) {
      await tx.insert(schema.metaEquipeRateio).values(
        rateio.map((r) => ({
          metaEquipeId: id,
          fornecedorId: r.fornecedorId,
          pessoaNome: r.nome,
          minutosTrabalhados: r.minutos,
          valorRateado: String(r.valor),
        })),
      );
    }
    await tx
      .update(schema.metaEquipe)
      .set({
        status: 'avaliada',
        valorRealizado: String(valorRealizado),
        bateuMeta,
        regraSnapshot,
        avaliadaEm: new Date(),
        avaliadaPor: user.id,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.metaEquipe.id, id));
  });

  return NextResponse.json({ ok: true, valorRealizado, valorAlvo, bateuMeta, rateio });
}
