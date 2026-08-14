// POST /api/cotacao/[id]/zerar-resposta
// Gestor apaga TODAS as respostas de UM fornecedor pra ele preencher de novo
// (ex: preencheu com valores errados). Volta o status pra PENDENTE e, se a
// cotação já fechou, estende o prazo em 4h pra o MESMO link voltar a aceitar.
//
// Body: { cotacaoFornecedorId }

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: cotacaoId } = await params;

  let body: { cotacaoFornecedorId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  if (!body.cotacaoFornecedorId) {
    return NextResponse.json({ error: 'cotacaoFornecedorId obrigatorio' }, { status: 400 });
  }

  const [cot] = await db
    .select({ id: schema.cotacao.id, status: schema.cotacao.status, fechaEm: schema.cotacao.fechaEm })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, cotacaoId))
    .limit(1);
  if (!cot) return NextResponse.json({ error: 'cotacao nao encontrada' }, { status: 404 });
  if (cot.status === 'APROVADA' || cot.status === 'CONCLUIDA' || cot.status === 'CANCELADA') {
    return NextResponse.json(
      { error: `cotacao ${cot.status.toLowerCase()} — nao da mais pra zerar resposta` },
      { status: 400 },
    );
  }

  const [cf] = await db
    .select({ id: schema.cotacaoFornecedor.id })
    .from(schema.cotacaoFornecedor)
    .where(
      and(
        eq(schema.cotacaoFornecedor.id, body.cotacaoFornecedorId),
        eq(schema.cotacaoFornecedor.cotacaoId, cotacaoId),
      ),
    )
    .limit(1);
  if (!cf) return NextResponse.json({ error: 'fornecedor nao convocado nesta cotacao' }, { status: 404 });

  await db
    .delete(schema.cotacaoRespostaItem)
    .where(eq(schema.cotacaoRespostaItem.cotacaoFornecedorId, cf.id));

  await db
    .update(schema.cotacaoFornecedor)
    .set({ status: 'PENDENTE', respondidoEm: null })
    .where(eq(schema.cotacaoFornecedor.id, cf.id));

  // Cotação já fechada: reabre por 4h pra o fornecedor conseguir reenviar
  // pelo MESMO link (o token não muda). Vale pra todos os convocados — quem
  // já respondeu certo não precisa mexer, mas pode corrigir se quiser.
  let novaFechaEm: Date | null = null;
  if (cot.fechaEm && new Date(cot.fechaEm) < new Date()) {
    novaFechaEm = new Date(Date.now() + 4 * 3600 * 1000);
    await db
      .update(schema.cotacao)
      .set({ fechaEm: novaFechaEm })
      .where(eq(schema.cotacao.id, cotacaoId));
  }

  return NextResponse.json({
    ok: true,
    novaFechaEm: novaFechaEm ? novaFechaEm.toISOString() : null,
  });
}
