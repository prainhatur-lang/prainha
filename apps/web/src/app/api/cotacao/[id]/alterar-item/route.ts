// POST /api/cotacao/[id]/alterar-item
// Gestor altera a QUANTIDADE de um item da cotação (ex: lista veio com 1 kg
// mas o pedido real é 20 kg). Só enquanto a cotação não foi aprovada — depois
// da aprovação o pedido já foi gerado e enviado com os números antigos.
//
// Body: { cotacaoItemId, quantidade?, observacao? } — pelo menos um dos dois.
// A observação do item é a instrução que o fornecedor vê no formulário
// ("caixa grande", "marca X") — editável enquanto a cotação está viva.

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

  let body: { cotacaoItemId?: string; quantidade?: number; observacao?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const temQtd = body.quantidade !== undefined;
  const temObs = 'observacao' in body;
  const qtd = Number(body.quantidade);
  if (!body.cotacaoItemId || (!temQtd && !temObs)) {
    return NextResponse.json(
      { error: 'cotacaoItemId e (quantidade ou observacao) obrigatorios' },
      { status: 400 },
    );
  }
  if (temQtd && (!Number.isFinite(qtd) || qtd <= 0)) {
    return NextResponse.json({ error: 'quantidade > 0 obrigatoria' }, { status: 400 });
  }

  const [cot] = await db
    .select({ id: schema.cotacao.id, status: schema.cotacao.status })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, cotacaoId))
    .limit(1);
  if (!cot) return NextResponse.json({ error: 'cotacao nao encontrada' }, { status: 404 });
  if (cot.status === 'APROVADA' || cot.status === 'CONCLUIDA' || cot.status === 'CANCELADA') {
    return NextResponse.json(
      { error: `cotacao ${cot.status.toLowerCase()} — quantidade nao pode mais mudar aqui` },
      { status: 400 },
    );
  }

  const [item] = await db
    .select({ id: schema.cotacaoItem.id })
    .from(schema.cotacaoItem)
    .where(
      and(eq(schema.cotacaoItem.id, body.cotacaoItemId), eq(schema.cotacaoItem.cotacaoId, cotacaoId)),
    )
    .limit(1);
  if (!item) return NextResponse.json({ error: 'item nao pertence a esta cotacao' }, { status: 404 });

  const set: Partial<typeof schema.cotacaoItem.$inferInsert> = {};
  if (temQtd) set.quantidade = String(qtd);
  if (temObs) set.observacao = body.observacao?.trim().slice(0, 300) || null;
  await db.update(schema.cotacaoItem).set(set).where(eq(schema.cotacaoItem.id, item.id));

  return NextResponse.json({ ok: true });
}
