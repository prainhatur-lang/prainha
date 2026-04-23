// POST /api/conciliacao/banco/match-manual
// Body: { excecaoCieloId: string, excecoesCreditoIds: string[] }
//
// Concilia manualmente um grupo pendente (CIELO_NAO_PAGO) com N creditos
// do banco (CREDITO_SEM_CIELO) que o user selecionou. Valida que a soma
// dos creditos bate com o valor do grupo (tol 10 centavos). Marca todas
// as N+1 excecoes como aceitas com observacao linkando entre si.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  excecaoCieloId: z.string().uuid(),
  excecoesCreditoIds: z.array(z.string().uuid()).min(1).max(50),
  observacao: z.string().max(500).optional(),
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
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  const { excecaoCieloId, excecoesCreditoIds, observacao } = parsed.data;

  // Carrega exceções
  const excCielo = await db
    .select({
      id: schema.excecao.id,
      filialId: schema.excecao.filialId,
      tipo: schema.excecao.tipo,
      valor: schema.excecao.valor,
      aceitaEm: schema.excecao.aceitaEm,
    })
    .from(schema.excecao)
    .where(eq(schema.excecao.id, excecaoCieloId))
    .limit(1);
  if (!excCielo.length) {
    return NextResponse.json({ error: 'excecao nao encontrada' }, { status: 404 });
  }
  const eC = excCielo[0]!;
  if (eC.tipo !== 'CIELO_NAO_PAGO') {
    return NextResponse.json({ error: 'excecao nao e CIELO_NAO_PAGO' }, { status: 400 });
  }
  if (eC.aceitaEm) {
    return NextResponse.json({ error: 'excecao ja aceita' }, { status: 400 });
  }

  // RBAC
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, eC.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const excCreditos = await db
    .select({
      id: schema.excecao.id,
      filialId: schema.excecao.filialId,
      tipo: schema.excecao.tipo,
      valor: schema.excecao.valor,
      aceitaEm: schema.excecao.aceitaEm,
    })
    .from(schema.excecao)
    .where(inArray(schema.excecao.id, excecoesCreditoIds));
  if (excCreditos.length !== excecoesCreditoIds.length) {
    return NextResponse.json({ error: 'algumas excecoes de credito nao encontradas' }, { status: 404 });
  }
  for (const eCr of excCreditos) {
    if (eCr.filialId !== eC.filialId) {
      return NextResponse.json({ error: 'excecao de outra filial' }, { status: 400 });
    }
    if (eCr.tipo !== 'CREDITO_SEM_CIELO') {
      return NextResponse.json({ error: 'excecao nao e CREDITO_SEM_CIELO' }, { status: 400 });
    }
    if (eCr.aceitaEm) {
      return NextResponse.json({ error: 'credito ja conciliado em outro grupo' }, { status: 400 });
    }
  }

  // Validacao: soma dos creditos bate com valor do grupo (tol 10 centavos)
  const valorGrupo = Number(eC.valor ?? 0);
  const somaCreditos = excCreditos.reduce((s, e) => s + Number(e.valor ?? 0), 0);
  const diff = Math.abs(valorGrupo - somaCreditos);
  if (diff > 0.10) {
    return NextResponse.json(
      {
        error: `soma dos creditos (R$ ${somaCreditos.toFixed(2)}) nao bate com valor do grupo (R$ ${valorGrupo.toFixed(2)}). Diff R$ ${diff.toFixed(2)} excede tolerancia de R$ 0,10.`,
      },
      { status: 400 },
    );
  }

  // Aplica: marca todas as N+1 excecoes como aceitas
  const now = new Date();
  const obsBase = observacao ? ` Obs: ${observacao}` : '';
  await db
    .update(schema.excecao)
    .set({
      aceitaEm: now,
      aceitaPor: user.id,
      observacao: `Match manual: R$ ${valorGrupo.toFixed(2)} conciliado com ${excCreditos.length} credito(s) do banco somando R$ ${somaCreditos.toFixed(2)}.${obsBase}`,
    })
    .where(eq(schema.excecao.id, excecaoCieloId));
  await db
    .update(schema.excecao)
    .set({
      aceitaEm: now,
      aceitaPor: user.id,
      observacao: `Match manual: conciliado com grupo Cielo R$ ${valorGrupo.toFixed(2)} (exc ${excecaoCieloId.slice(0, 8)}).${obsBase}`,
    })
    .where(inArray(schema.excecao.id, excecoesCreditoIds));

  return NextResponse.json({
    ok: true,
    conciliadoValor: valorGrupo,
    somaCreditos,
    diff,
  });
}
