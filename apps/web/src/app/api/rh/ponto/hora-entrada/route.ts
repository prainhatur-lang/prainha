// Trava de ponto antes da hora (pedido do dono 24/10/2026: "não permitir bater
// o ponto antes da hora sem autorização"). Grava funcionario.ponto_hora_entrada;
// a loja recebe no roster do ponto e o tablet recusa a PRIMEIRA entrada do dia
// antes da hora − 10 min. Volta do intervalo e saída nunca são barradas.
//
//  - { funcionarioIds, hora }        → marca ("HH:MM") ou tira (null) a hora;
//  - { funcionarioId, liberarHoje }  → o gerente autoriza (ou desfaz) bater
//    antes da hora só no dia de hoje.
// Depois avisa as lojas dessas pessoas pra puxarem o roster na hora (mesmo
// empurrão da trava da semana); loja que não responde pega no pull de 3 em 3 min.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq, inArray } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { avisarLojaRosterPonto } from '@/lib/ponto-loja';
import { dateToBrYmd } from '@/lib/datas';
import { PONTO_VIRADA_HORA } from '@/lib/rh/dia-operacional';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const Body = z.union([
  z.object({
    funcionarioIds: z.array(z.string().uuid()).min(1).max(200),
    hora: Hora.nullable(),
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
  if (!parsed.success) return NextResponse.json({ error: 'hora inválida (use HH:MM)' }, { status: 400 });
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
      .set({ pontoHoraEntrada: corpo.hora, atualizadoEm: new Date() })
      .where(inArray(schema.funcionario.id, ids));
  } else {
    const hoje = dateToBrYmd(new Date(Date.now() - PONTO_VIRADA_HORA * 3600 * 1000));
    await db
      .update(schema.funcionario)
      .set({ pontoCedoLiberadoDia: corpo.liberarHoje ? hoje : null, atualizadoEm: new Date() })
      .where(eq(schema.funcionario.id, corpo.funcionarioId));
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
        if (!r.ok) console.warn(`[ponto] hora-entrada: aviso não chegou na loja ${filialId.slice(0, 8)}: ${r.erro}`);
        return { nome: nomes.find((n) => n.id === filialId)?.nome ?? 'loja', avisada: r.ok };
      }),
    );
  } catch (err) {
    console.warn('[ponto] hora-entrada: aviso às lojas falhou:', err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ ok: true, lojas });
}
