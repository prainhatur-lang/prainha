// Vale transporte quinzenal — ações da tela /rh/vale-transporte:
//   pessoa   VT da pessoa (valor do dia ida+volta, dias por semana, ativo)
//   pagar    grava a quinzena como paga (o servidor recalcula previsto e acerto;
//            da tela só vêm os dias previstos de cada um)
//   reabrir  apaga a quinzena paga — só se a seguinte ainda não foi paga,
//            senão o acerto da seguinte perde a base
// Não mexe em folha, ponto nem contas a pagar.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { montarQuinzenaVt, quinzenaDe, quinzenaSeguinte, valorPagar } from '@/lib/rh/vale-transporte';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Dia = z.string().regex(/^\d{4}-\d{2}-(01|16)$/);

const Body = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('pessoa'),
    funcionarioId: z.string().uuid(),
    ativo: z.boolean(),
    valorDia: z.number().min(0).max(500),
    diasSemana: z.number().int().min(1).max(7).nullable(),
  }),
  z.object({
    acao: z.literal('pagar'),
    filialId: z.string().uuid(),
    inicio: Dia,
    dias: z.record(z.string().uuid(), z.number().int().min(0).max(16)),
  }),
  z.object({
    acao: z.literal('reabrir'),
    filialId: z.string().uuid(),
    inicio: Dia,
  }),
]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'dados inválidos', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const filiais = await filiaisDoUsuario(user.id);

  if (d.acao === 'pessoa') {
    const semPerm = await negarSemPerm(user.id, 'funcionario.update');
    if (semPerm) return semPerm;
    const [func] = await db
      .select({ filialId: schema.funcionario.filialId })
      .from(schema.funcionario)
      .where(eq(schema.funcionario.id, d.funcionarioId))
      .limit(1);
    if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
    if (!filiais.some((f) => f.id === func.filialId)) {
      return NextResponse.json({ error: 'sem acesso à casa desse funcionário' }, { status: 403 });
    }
    const valores = {
      ativo: d.ativo,
      valorDia: d.valorDia.toFixed(2),
      diasSemana: d.diasSemana,
      atualizadoEm: new Date(),
      atualizadoPor: user.id,
    };
    await db
      .insert(schema.vtPessoa)
      .values({ funcionarioId: d.funcionarioId, ...valores })
      .onConflictDoUpdate({ target: schema.vtPessoa.funcionarioId, set: valores });
    return NextResponse.json({ ok: true });
  }

  const semPerm = await negarSemPerm(user.id, 'folha_equipe.fechar');
  if (semPerm) return semPerm;
  if (!filiais.some((f) => f.id === d.filialId)) {
    return NextResponse.json({ error: 'sem acesso a essa casa' }, { status: 403 });
  }
  const q = quinzenaDe(d.inicio);

  if (d.acao === 'reabrir') {
    const seg = quinzenaSeguinte(q);
    const [pagaSeg] = await db
      .select({ id: schema.vtQuinzena.id })
      .from(schema.vtQuinzena)
      .where(and(eq(schema.vtQuinzena.filialId, d.filialId), eq(schema.vtQuinzena.dataInicio, seg.inicio)))
      .limit(1);
    if (pagaSeg) {
      return NextResponse.json({ error: 'a quinzena seguinte já foi paga; reabra ela primeiro' }, { status: 409 });
    }
    await db
      .delete(schema.vtQuinzena)
      .where(and(eq(schema.vtQuinzena.filialId, d.filialId), eq(schema.vtQuinzena.dataInicio, q.inicio)));
    return NextResponse.json({ ok: true });
  }

  // pagar
  const vt = await montarQuinzenaVt(d.filialId, q);
  if (vt.paga) return NextResponse.json({ error: 'quinzena já está paga' }, { status: 409 });

  const itens = vt.linhas
    .filter((l) => l.vt?.ativo && l.vt.valorDia > 0)
    .map((l) => {
      const valorDia = l.vt!.valorDia;
      const dias = d.dias[l.funcionarioId] ?? l.diasPrevistos;
      const previsto = Math.round(dias * valorDia * 100) / 100;
      const acerto = l.anterior?.saldo ?? 0;
      return {
        funcionarioId: l.funcionarioId,
        valorDia: valorDia.toFixed(2),
        diasPrevistos: dias,
        valorPrevisto: previsto.toFixed(2),
        acertoAnterior: acerto.toFixed(2),
        valorPago: valorPagar(previsto, acerto).toFixed(2),
      };
    });
  if (!itens.length) {
    return NextResponse.json({ error: 'ninguém com VT cadastrado nessa casa' }, { status: 400 });
  }

  const total = await db.transaction(async (tx) => {
    const [criada] = await tx
      .insert(schema.vtQuinzena)
      .values({ filialId: d.filialId, dataInicio: q.inicio, dataFim: q.fim, pagaPor: user.id })
      .onConflictDoNothing()
      .returning({ id: schema.vtQuinzena.id });
    if (!criada) return null;
    await tx.insert(schema.vtQuinzenaItem).values(itens.map((i) => ({ ...i, quinzenaId: criada.id })));
    return itens.reduce((s, i) => s + Number(i.valorPago), 0);
  });
  if (total === null) return NextResponse.json({ error: 'quinzena já está paga' }, { status: 409 });
  return NextResponse.json({ ok: true, pessoas: itens.length, total });
}
