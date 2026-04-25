// POST /api/sugestao-cross-route/[id] body { acao: 'aceitar' | 'rejeitar' }
//
// Aceitar:
//  - Se tipo=PDV_ADQUIRENTE_PARA_BANCO: cria match_pdv_banco e (opcional)
//    reclassifica forma de pagamento como DIRETO se for padrao
//  - Se tipo=PDV_DIRETO_PARA_CIELO: marca match na conciliacao_pagamento
//    apontando pra venda_adquirente_id (engine operadora vai pegar na proxima
//    rodada e fechar)
//  - Marca sugestao com aceitoEm + aceitoPor
//
// Rejeitar:
//  - Marca sugestao com rejeitadoEm + rejeitadoPor
//  - Sugestao nao volta a ser gerada na proxima rodada (cross-route limpa
//    SO as nao decididas)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  acao: z.enum(['aceitar', 'rejeitar']),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [sug] = await db
    .select()
    .from(schema.sugestaoCrossRoute)
    .where(eq(schema.sugestaoCrossRoute.id, id))
    .limit(1);
  if (!sug) return NextResponse.json({ error: 'sugestao nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, sug.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  if (sug.aceitoEm || sug.rejeitadoEm) {
    return NextResponse.json({ error: 'sugestao ja decidida' }, { status: 409 });
  }

  if (parsed.data.acao === 'rejeitar') {
    await db
      .update(schema.sugestaoCrossRoute)
      .set({ rejeitadoEm: new Date(), rejeitadoPor: user.id })
      .where(eq(schema.sugestaoCrossRoute.id, id));
    return NextResponse.json({ id, ok: true, acao: 'rejeitar' });
  }

  // Aceitar: cria match real conforme o tipo
  if (sug.tipo === 'PDV_ADQUIRENTE_PARA_BANCO') {
    if (!sug.lancamentoBancoId) {
      return NextResponse.json(
        { error: 'sugestao sem lancamento_banco_id' },
        { status: 400 },
      );
    }
    try {
      await db.insert(schema.matchPdvBanco).values({
        filialId: sug.filialId,
        pagamentoId: sug.pagamentoId,
        lancamentoBancoId: sug.lancamentoBancoId,
        nivelMatch: '1',
        criadoPor: user.id,
        observacao: `Aceito de sugestao cross-route (ADQUIRENTE→DIRETO). ${sug.motivo ?? ''}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unique')) {
        return NextResponse.json(
          { error: 'pagamento ja tem match no banco' },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // Limpa excecao PDV_SEM_CIELO desse pagamento (foi resolvida)
    await db
      .delete(schema.excecao)
      .where(
        and(
          eq(schema.excecao.pagamentoId, sug.pagamentoId),
          eq(schema.excecao.processo, 'OPERADORA'),
          eq(schema.excecao.tipo, 'PDV_SEM_CIELO'),
        ),
      );
  } else if (sug.tipo === 'PDV_DIRETO_PARA_CIELO') {
    if (!sug.vendaAdquirenteId) {
      return NextResponse.json(
        { error: 'sugestao sem venda_adquirente_id' },
        { status: 400 },
      );
    }
    // Cria conciliacao_pagamento ligando pagamento <-> venda_adquirente.
    // Esse e o registro que a engine operadora consulta.
    try {
      await db
        .insert(schema.conciliacaoPagamento)
        .values({
          pagamentoId: sug.pagamentoId,
          filialId: sug.filialId,
          etapa: 'COMPLETO',
          vendaAdquirenteId: sug.vendaAdquirenteId,
          detalhes: { fonte: 'cross_route_aceito', motivo: sug.motivo },
        })
        .onConflictDoUpdate({
          target: schema.conciliacaoPagamento.pagamentoId,
          set: {
            etapa: 'COMPLETO',
            vendaAdquirenteId: sug.vendaAdquirenteId,
            rodadoEm: new Date(),
          },
        });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } else {
    return NextResponse.json({ error: `tipo desconhecido: ${sug.tipo}` }, { status: 400 });
  }

  await db
    .update(schema.sugestaoCrossRoute)
    .set({ aceitoEm: new Date(), aceitoPor: user.id })
    .where(eq(schema.sugestaoCrossRoute.id, id));

  return NextResponse.json({ id, ok: true, acao: 'aceitar' });
}
