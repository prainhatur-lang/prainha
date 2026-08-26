// Correção manual de ponto — inclusão, alteração ou exclusão de 1 batida.
// justificativa é obrigatória (min 10 chars): toda correção fica registrada
// em ponto_batida_ajuste com o antes/depois, pra auditoria de RH.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { projetarPontoEmFolhaHoras } from '@/lib/rh/projetar-horas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  funcionarioId: z.string().uuid(),
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  acao: z.enum(['inclusao', 'alteracao', 'exclusao']),
  batidaId: z.string().uuid().optional(),
  quando: z.string().min(10).optional(),
  tipo: z.enum(['entrada', 'saida']).optional(),
  justificativa: z.string().min(10).max(500),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const semPerm = await negarSemPerm(user.id, 'ponto.corrigir');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body inválido', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  if (d.acao !== 'exclusao' && (!d.quando || !d.tipo)) {
    return NextResponse.json({ error: 'quando e tipo são obrigatórios pra incluir/alterar' }, { status: 400 });
  }
  if (d.acao !== 'inclusao' && !d.batidaId) {
    return NextResponse.json({ error: 'batidaId é obrigatório pra alterar/excluir' }, { status: 400 });
  }

  const [func] = await db
    .select({ filialId: schema.funcionario.filialId })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, d.funcionarioId))
    .limit(1);
  if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, func.filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  let batidaId: string | null = null;
  let valorAntes: { quando: string; tipo: string } | null = null;
  let valorDepois: { quando: string; tipo: string } | null = null;

  if (d.acao === 'inclusao') {
    const [criada] = await db
      .insert(schema.pontoBatida)
      .values({
        filialId: func.filialId,
        funcionarioId: d.funcionarioId,
        quando: new Date(d.quando!),
        diaOperacional: d.dia,
        tipo: d.tipo!,
        origem: 'correcao',
      })
      .returning({ id: schema.pontoBatida.id });
    batidaId = criada.id;
    valorDepois = { quando: d.quando!, tipo: d.tipo! };
  } else {
    const [atual] = await db
      .select()
      .from(schema.pontoBatida)
      .where(and(eq(schema.pontoBatida.id, d.batidaId!), eq(schema.pontoBatida.funcionarioId, d.funcionarioId)))
      .limit(1);
    if (!atual) return NextResponse.json({ error: 'batida não encontrada' }, { status: 404 });
    valorAntes = { quando: atual.quando.toISOString(), tipo: atual.tipo };
    batidaId = atual.id;

    if (d.acao === 'alteracao') {
      await db
        .update(schema.pontoBatida)
        .set({ quando: new Date(d.quando!), tipo: d.tipo!, origem: 'correcao' })
        .where(eq(schema.pontoBatida.id, atual.id));
      valorDepois = { quando: d.quando!, tipo: d.tipo! };
    } else {
      await db
        .update(schema.pontoBatida)
        .set({ excluidaEm: new Date(), excluidaPor: user.id })
        .where(eq(schema.pontoBatida.id, atual.id));
      valorDepois = null;
    }
  }

  await db.insert(schema.pontoBatidaAjuste).values({
    filialId: func.filialId,
    funcionarioId: d.funcionarioId,
    batidaId,
    dia: d.dia,
    acao: d.acao,
    valorAntes,
    valorDepois,
    justificativa: d.justificativa,
    usuarioId: user.id,
  });

  const resultado = await projetarPontoEmFolhaHoras(func.filialId, d.dia, d.dia);
  return NextResponse.json({ ok: true, ...resultado });
}
