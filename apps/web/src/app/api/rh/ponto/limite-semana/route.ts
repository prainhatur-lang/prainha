// Trava de dias por semana no ponto facial (pedido do dono 20/10/2026: quem
// trabalha SEM REGISTRO só pode trabalhar 2 vezes na semana). Grava em
// funcionario.limite_dias_semana; a loja recebe no roster do ponto e o tablet
// recusa a ENTRADA de um dia novo quando a pessoa já bateu ponto em N dias da
// semana (seg–dom, dia operacional, somando as casas).
//
//  - { funcionarioIds, limite }  → marca (1–6) ou tira (null) o limite;
//  - { funcionarioId, liberarHoje } → o gerente libera (ou desfaz) só o dia de
//    hoje por fora da trava.
// Depois avisa as lojas dessas pessoas pra puxarem o roster na hora (mesmo
// empurrão dos gêmeos); loja que não responde pega no pull de 3 em 3 min.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { avisarLojaRosterPonto } from '@/lib/ponto-loja';
import { dateToBrYmd } from '@/lib/datas';
import { PONTO_VIRADA_HORA } from '@/lib/rh/dia-operacional';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const Body = z.union([
  z.object({
    funcionarioIds: z.array(z.string().uuid()).min(1).max(200),
    limite: z.number().int().min(1).max(6).nullable(),
  }),
  z.object({
    funcionarioId: z.string().uuid(),
    liberarHoje: z.boolean(),
  }),
]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const semPerm = await negarSemPerm(user.id, 'ponto.corrigir');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'body inválido' }, { status: 400 });
  const corpo = parsed.data;
  const ids = 'funcionarioIds' in corpo ? [...new Set(corpo.funcionarioIds)] : [corpo.funcionarioId];

  const pessoas = await db
    .select({ id: schema.funcionario.id, filialId: schema.funcionario.filialId })
    .from(schema.funcionario)
    .where(inArray(schema.funcionario.id, ids));
  if (pessoas.length !== ids.length) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });

  // Quem mexe precisa enxergar uma casa de cada pessoa (principal ou extra).
  const extras = await db
    .select({ funcionarioId: schema.funcionarioFilialExtra.funcionarioId, filialId: schema.funcionarioFilialExtra.filialId })
    .from(schema.funcionarioFilialExtra)
    .where(inArray(schema.funcionarioFilialExtra.funcionarioId, ids));
  const minhas = new Set(
    (
      await db
        .select({ filialId: schema.usuarioFilial.filialId })
        .from(schema.usuarioFilial)
        .where(eq(schema.usuarioFilial.usuarioId, user.id))
    ).map((x) => x.filialId),
  );
  const casasDe = (id: string, principal: string) => [
    principal,
    ...extras.filter((x) => x.funcionarioId === id).map((x) => x.filialId),
  ];
  for (const p of pessoas) {
    if (!casasDe(p.id, p.filialId).some((c) => minhas.has(c))) {
      return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
    }
  }

  if ('funcionarioIds' in corpo) {
    await db
      .update(schema.funcionario)
      .set({ limiteDiasSemana: corpo.limite, atualizadoEm: new Date() })
      .where(inArray(schema.funcionario.id, ids));
  } else {
    const hoje = dateToBrYmd(new Date(Date.now() - PONTO_VIRADA_HORA * 3600 * 1000));
    await db
      .update(schema.funcionario)
      .set({ limiteLiberadoDia: corpo.liberarHoje ? hoje : null, atualizadoEm: new Date() })
      .where(and(eq(schema.funcionario.id, corpo.funcionarioId)));
  }

  // Daqui pra baixo nada derruba a resposta: já foi gravado.
  let lojas: { nome: string; avisada: boolean }[] = [];
  try {
    const filialIds = [...new Set(pessoas.flatMap((p) => casasDe(p.id, p.filialId)))];
    const nomes = await db
      .select({ id: schema.filial.id, nome: schema.filial.nome })
      .from(schema.filial)
      .where(inArray(schema.filial.id, filialIds));
    lojas = await Promise.all(
      filialIds.map(async (filialId) => {
        const r = await avisarLojaRosterPonto(filialId);
        if (!r.ok) console.warn(`[ponto] limite-semana: aviso não chegou na loja ${filialId.slice(0, 8)}: ${r.erro}`);
        return { nome: nomes.find((n) => n.id === filialId)?.nome ?? 'loja', avisada: r.ok };
      }),
    );
  } catch (err) {
    console.warn('[ponto] limite-semana: aviso às lojas falhou:', err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ ok: true, lojas });
}
