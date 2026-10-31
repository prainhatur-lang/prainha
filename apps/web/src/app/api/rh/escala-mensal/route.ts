// Escala do mês (tela /rh/escala-mensal):
//   salvar  grava os dias da grade (folga sim/não) de cada pessoa — upsert por
//           pessoa+dia; o VT da quinzena passa a contar os dias de trabalho dela
//   limpar  apaga a escala salva do mês da casa (volta pra sugestão)
//   sexo    'H' | 'M' do funcionário — regra do domingo (CCT cl.16 / CLT 386)
//   motivoAdmissao  por que a pessoa entrou (pendências da escala, 31/10/2026)
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { diasDoMes } from '@/lib/rh/escala-mensal';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const Body = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('salvar'),
    filialId: z.string().uuid(),
    mes: Mes,
    // funcionarioId → dia → folga
    dias: z.record(z.string().uuid(), z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.boolean())),
  }),
  z.object({ acao: z.literal('limpar'), filialId: z.string().uuid(), mes: Mes }),
  z.object({ acao: z.literal('sexo'), funcionarioId: z.string().uuid(), sexo: z.enum(['H', 'M']).nullable() }),
  z.object({ acao: z.literal('motivoAdmissao'), funcionarioId: z.string().uuid(), motivo: z.string().trim().min(1).max(200) }),
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
  const semPerm = await negarSemPerm(user.id, 'funcionario.update');
  if (semPerm) return semPerm;
  const filiais = await filiaisDoUsuario(user.id);

  if (d.acao === 'motivoAdmissao') {
    const [func] = await db
      .select({ filialId: schema.funcionario.filialId })
      .from(schema.funcionario)
      .where(eq(schema.funcionario.id, d.funcionarioId))
      .limit(1);
    if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
    if (!filiais.some((f) => f.id === func.filialId)) {
      return NextResponse.json({ error: 'sem acesso à casa desse funcionário' }, { status: 403 });
    }
    await db
      .update(schema.funcionario)
      .set({ motivoAdmissao: d.motivo, atualizadoEm: new Date() })
      .where(eq(schema.funcionario.id, d.funcionarioId));
    return NextResponse.json({ ok: true });
  }

  if (d.acao === 'sexo') {
    const [func] = await db
      .select({ filialId: schema.funcionario.filialId })
      .from(schema.funcionario)
      .where(eq(schema.funcionario.id, d.funcionarioId))
      .limit(1);
    if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
    if (!filiais.some((f) => f.id === func.filialId)) {
      return NextResponse.json({ error: 'sem acesso à casa desse funcionário' }, { status: 403 });
    }
    await db.update(schema.funcionario).set({ sexo: d.sexo }).where(eq(schema.funcionario.id, d.funcionarioId));
    return NextResponse.json({ ok: true });
  }

  if (!filiais.some((f) => f.id === d.filialId)) {
    return NextResponse.json({ error: 'sem acesso a essa casa' }, { status: 403 });
  }
  const dias = diasDoMes(d.mes);
  const inicio = dias[0];
  const fim = dias[dias.length - 1];

  if (d.acao === 'limpar') {
    await db
      .delete(schema.rhEscalaDia)
      .where(
        and(
          eq(schema.rhEscalaDia.filialId, d.filialId),
          gte(schema.rhEscalaDia.dia, inicio),
          lte(schema.rhEscalaDia.dia, fim),
        ),
      );
    return NextResponse.json({ ok: true });
  }

  // salvar: só gente da casa e dias do mês.
  const ids = Object.keys(d.dias);
  if (!ids.length) return NextResponse.json({ ok: true, linhas: 0 });
  const daCasa = new Set(
    (
      await db
        .select({ id: schema.funcionario.id })
        .from(schema.funcionario)
        .where(and(inArray(schema.funcionario.id, ids), eq(schema.funcionario.filialId, d.filialId)))
    ).map((r) => r.id),
  );
  const valores: (typeof schema.rhEscalaDia.$inferInsert)[] = [];
  for (const [fid, porDia] of Object.entries(d.dias)) {
    if (!daCasa.has(fid)) continue;
    for (const [dia, folga] of Object.entries(porDia)) {
      if (dia < inicio || dia > fim) continue;
      valores.push({ funcionarioId: fid, dia, filialId: d.filialId, folga, atualizadoPor: user.id });
    }
  }
  if (!valores.length) return NextResponse.json({ ok: true, linhas: 0 });
  await db
    .insert(schema.rhEscalaDia)
    .values(valores)
    .onConflictDoUpdate({
      target: [schema.rhEscalaDia.funcionarioId, schema.rhEscalaDia.dia],
      set: {
        folga: sql`excluded.folga`,
        filialId: sql`excluded.filial_id`,
        atualizadoEm: new Date(),
        atualizadoPor: user.id,
      },
    });
  return NextResponse.json({ ok: true, linhas: valores.length });
}
