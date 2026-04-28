// POST /api/excecoes/match-manual
// Body: { excecaoId: string, pariaIds: string[], observacao?: string,
//         forcarAceiteForaTolerancia?: boolean }
//
// Concilia manualmente qualquer excecao com N outras excecoes "pariadas"
// (tipicamente um lado "sem par" com o lado oposto). Valida que a soma
// dos valores dos parias bate com o valor da excecao principal (tol 10 cent).
// Quando diff excede a tolerancia, retorna 422 e o frontend deve confirmar
// com o user e reenviar com forcarAceiteForaTolerancia=true.
// Marca todas as N+1 excecoes como aceitas (inclui o diff na observacao).
//
// Usado pelos 3 processos (OPERADORA, RECEBIVEIS, BANCO). A logica nao
// depende do tipo — apenas valida soma.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  excecaoId: z.string().uuid(),
  pariaIds: z.array(z.string().uuid()).min(1).max(100),
  observacao: z.string().max(500).optional(),
  forcarAceiteForaTolerancia: z.boolean().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { excecaoId, pariaIds, observacao, forcarAceiteForaTolerancia } = parsed.data;

  // Exceção principal
  const excPrincipal = await db
    .select({
      id: schema.excecao.id,
      filialId: schema.excecao.filialId,
      valor: schema.excecao.valor,
      tipo: schema.excecao.tipo,
      aceitaEm: schema.excecao.aceitaEm,
    })
    .from(schema.excecao)
    .where(eq(schema.excecao.id, excecaoId))
    .limit(1);
  if (!excPrincipal.length) {
    return NextResponse.json({ error: 'excecao nao encontrada' }, { status: 404 });
  }
  const eP = excPrincipal[0]!;
  if (eP.aceitaEm) {
    return NextResponse.json({ error: 'excecao ja aceita' }, { status: 400 });
  }

  // RBAC
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, eP.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Exceções parias
  const excParias = await db
    .select({
      id: schema.excecao.id,
      filialId: schema.excecao.filialId,
      valor: schema.excecao.valor,
      aceitaEm: schema.excecao.aceitaEm,
    })
    .from(schema.excecao)
    .where(inArray(schema.excecao.id, pariaIds));
  if (excParias.length !== pariaIds.length) {
    return NextResponse.json(
      { error: 'algumas excecoes nao encontradas' },
      { status: 404 },
    );
  }
  for (const e of excParias) {
    if (e.filialId !== eP.filialId) {
      return NextResponse.json(
        { error: 'excecao de outra filial' },
        { status: 400 },
      );
    }
    if (e.aceitaEm) {
      return NextResponse.json(
        { error: 'uma das excecoes ja foi aceita em outro match' },
        { status: 400 },
      );
    }
  }

  // Valida soma (tol R$ 0,10)
  const valorPrincipal = Math.abs(Number(eP.valor ?? 0));
  const somaParias = excParias.reduce(
    (s, e) => s + Math.abs(Number(e.valor ?? 0)),
    0,
  );
  const diff = Math.abs(valorPrincipal - somaParias);
  const pctDiff = valorPrincipal > 0 ? (diff / valorPrincipal) * 100 : 0;
  // Quando diff > R$ 0,10, exige que o user tenha confirmado explicitamente
  // (forcarAceiteForaTolerancia=true). Frontend mostra confirm() antes de
  // reenviar a requisicao com a flag. Sem flag, retorna 422 com detalhes.
  if (diff > 0.10 && !forcarAceiteForaTolerancia) {
    return NextResponse.json(
      {
        error: 'DIFF_FORA_DE_TOLERANCIA',
        mensagem: `Soma das excecoes pareadas (R$ ${somaParias.toFixed(2)}) nao bate com valor (R$ ${valorPrincipal.toFixed(2)}). Diff R$ ${diff.toFixed(2)} (${pctDiff.toFixed(2)}%) excede tolerancia R$ 0,10. Reenvie com forcarAceiteForaTolerancia=true se confirmar.`,
        valorPrincipal,
        somaParias,
        diff,
        pctDiff,
      },
      { status: 422 },
    );
  }

  // Marca todas como aceitas
  const now = new Date();
  const obsExtra = observacao ? ` Obs: ${observacao}` : '';
  const diffNota = diff > 0.10
    ? ` Diff R$ ${diff.toFixed(2)} (${pctDiff.toFixed(2)}%) — match com diff fora de tolerancia, aceito pelo user.`
    : '';
  await db
    .update(schema.excecao)
    .set({
      aceitaEm: now,
      aceitaPor: user.id,
      observacao: `Match manual: linkado a ${excParias.length} outra(s) excecao(oes) somando R$ ${somaParias.toFixed(2)}.${diffNota}${obsExtra}`,
    })
    .where(eq(schema.excecao.id, excecaoId));
  await db
    .update(schema.excecao)
    .set({
      aceitaEm: now,
      aceitaPor: user.id,
      observacao: `Match manual: linkado a excecao principal (R$ ${valorPrincipal.toFixed(2)}, id ${excecaoId.slice(0, 8)}).${diffNota}${obsExtra}`,
    })
    .where(inArray(schema.excecao.id, pariaIds));

  return NextResponse.json({
    ok: true,
    valorPrincipal,
    somaParias,
    diff,
  });
}
