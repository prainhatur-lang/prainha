// Marca (ou desmarca) duas pessoas como GÊMEAS no ponto facial. A câmera não
// separa gêmeos idênticos — o "número" do rosto das duas sai praticamente
// igual (10/10/2026, Prainha Bar: uma batia e o tablet registrava a outra, e a
// segunda nem conseguia cadastrar o próprio rosto, "parecido com o de ...").
// Com o par marcado, a loja recebe `gemeo_de` no roster e o tablet, ao
// reconhecer qualquer uma das duas, pergunta "Quem é você?" com os dois nomes
// em vez de bater direto.
//
// O vínculo é gravado dos DOIS lados (A aponta pra B e B pra A). Marcar um par
// novo solta o par antigo de quem estava envolvido; gemeoDeId nulo só solta.
// Depois avisa as lojas onde essas pessoas batem ponto pra puxarem o roster na
// hora (mesmo empurrão do apagar-rosto): se a loja não responde, pega no pull
// de 3 em 3 min.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, or } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { avisarLojaRosterPonto } from '@/lib/ponto-loja';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30; // cada loja segura o aviso até 5 s enquanto puxa o roster

const Body = z.object({
  funcionarioId: z.string().uuid(),
  gemeoDeId: z.string().uuid().nullable(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const semPerm = await negarSemPerm(user.id, 'ponto.corrigir');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'body inválido' }, { status: 400 });
  const { funcionarioId, gemeoDeId } = parsed.data;
  if (gemeoDeId === funcionarioId) {
    return NextResponse.json({ error: 'escolha duas pessoas diferentes' }, { status: 400 });
  }

  const pedidos = gemeoDeId ? [funcionarioId, gemeoDeId] : [funcionarioId];
  const pessoas = await db
    .select({ id: schema.funcionario.id, nome: schema.funcionario.nome, filialId: schema.funcionario.filialId })
    .from(schema.funcionario)
    .where(inArray(schema.funcionario.id, pedidos));
  if (pessoas.length !== pedidos.length) {
    return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
  }

  // Quem mexe precisa enxergar uma casa de cada pessoa — a principal ou um
  // vínculo extra, a mesma regra de quem aparece na lista do /rh/ponto.
  const extrasPedidos = await db
    .select({ funcionarioId: schema.funcionarioFilialExtra.funcionarioId, filialId: schema.funcionarioFilialExtra.filialId })
    .from(schema.funcionarioFilialExtra)
    .where(inArray(schema.funcionarioFilialExtra.funcionarioId, pedidos));
  const minhas = new Set(
    (
      await db
        .select({ filialId: schema.usuarioFilial.filialId })
        .from(schema.usuarioFilial)
        .where(eq(schema.usuarioFilial.usuarioId, user.id))
    ).map((x) => x.filialId),
  );
  for (const p of pessoas) {
    const casas = [p.filialId, ...extrasPedidos.filter((x) => x.funcionarioId === p.id).map((x) => x.filialId)];
    if (!casas.some((c) => minhas.has(c))) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
  }

  // Todo mundo que muda: os dois pedidos + quem hoje aponta pra um deles (o par
  // antigo de cada um). Solta todos e só então liga o par novo.
  const afetados = await db.transaction(async (tx) => {
    const antes = await tx
      .select({ id: schema.funcionario.id })
      .from(schema.funcionario)
      .where(or(inArray(schema.funcionario.id, pedidos), inArray(schema.funcionario.gemeoDeId, pedidos)));
    const ids = antes.map((x) => x.id);
    await tx
      .update(schema.funcionario)
      .set({ gemeoDeId: null, atualizadoEm: new Date() })
      .where(inArray(schema.funcionario.id, ids));
    if (gemeoDeId) {
      await tx
        .update(schema.funcionario)
        .set({ gemeoDeId, atualizadoEm: new Date() })
        .where(eq(schema.funcionario.id, funcionarioId));
      await tx
        .update(schema.funcionario)
        .set({ gemeoDeId: funcionarioId, atualizadoEm: new Date() })
        .where(eq(schema.funcionario.id, gemeoDeId));
    }
    return ids;
  });

  // Daqui pra baixo nada derruba a resposta: o vínculo já foi gravado.
  let lojas: { nome: string; avisada: boolean; atualizada: boolean }[] = [];
  try {
    const principais = await db
      .select({ filialId: schema.funcionario.filialId })
      .from(schema.funcionario)
      .where(and(inArray(schema.funcionario.id, afetados), eq(schema.funcionario.ativo, true)));
    const extras = await db
      .select({ filialId: schema.funcionarioFilialExtra.filialId })
      .from(schema.funcionarioFilialExtra)
      .where(inArray(schema.funcionarioFilialExtra.funcionarioId, afetados));
    const filialIds = [...new Set([...principais.map((x) => x.filialId), ...extras.map((x) => x.filialId)])];
    if (filialIds.length) {
      const nomes = await db
        .select({ id: schema.filial.id, nome: schema.filial.nome })
        .from(schema.filial)
        .where(inArray(schema.filial.id, filialIds));
      lojas = await Promise.all(
        filialIds.map(async (filialId) => {
          const r = await avisarLojaRosterPonto(filialId);
          if (!r.ok) console.warn(`[ponto] aviso de roster não chegou na loja ${filialId.slice(0, 8)}: ${r.erro}`);
          return {
            nome: nomes.find((n) => n.id === filialId)?.nome ?? 'loja',
            avisada: r.ok,
            atualizada: r.ok && r.atualizado,
          };
        }),
      );
    }
  } catch (err) {
    console.warn('[ponto] aviso de roster às lojas falhou:', err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ ok: true, lojas });
}
