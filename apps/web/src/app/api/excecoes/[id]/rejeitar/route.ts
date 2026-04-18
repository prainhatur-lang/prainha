// POST /api/excecoes/[id]/rejeitar
// Rejeita um pre-match / divergencia: apaga a excecao original e cria duas
// separadas (PDV sem Cielo + Cielo sem PDV) para o usuario tratar cada lado.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PROCESSO_OPERADORA = 'OPERADORA';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  // Carrega excecao + lados associados
  const [exc] = await db
    .select({
      id: schema.excecao.id,
      filialId: schema.excecao.filialId,
      processo: schema.excecao.processo,
      pagamentoId: schema.excecao.pagamentoId,
      vendaAdquirenteId: schema.excecao.vendaAdquirenteId,
    })
    .from(schema.excecao)
    .where(eq(schema.excecao.id, id))
    .limit(1);
  if (!exc) return NextResponse.json({ error: 'nao encontrada' }, { status: 404 });

  // RBAC
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, exc.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  if (!exc.pagamentoId || !exc.vendaAdquirenteId) {
    return NextResponse.json(
      { error: 'excecao nao tem ambos os lados (PDV e Cielo) para desassociar' },
      { status: 400 },
    );
  }

  // Carrega dados do PDV e Cielo pra montar descricao das novas excecoes
  const [pag] = await db
    .select({
      nsu: schema.pagamento.nsuTransacao,
      valor: schema.pagamento.valor,
      forma: schema.pagamento.formaPagamento,
      pedido: schema.pagamento.codigoPedidoExterno,
    })
    .from(schema.pagamento)
    .where(eq(schema.pagamento.id, exc.pagamentoId))
    .limit(1);
  const [ven] = await db
    .select({
      nsu: schema.vendaAdquirente.nsu,
      valorBruto: schema.vendaAdquirente.valorBruto,
    })
    .from(schema.vendaAdquirente)
    .where(eq(schema.vendaAdquirente.id, exc.vendaAdquirenteId))
    .limit(1);

  const pedidoTxt = pag?.pedido ? `Pedido #${pag.pedido}` : 'Pedido ?';

  await db.transaction(async (tx) => {
    // Apaga a divergencia
    await tx.delete(schema.excecao).where(eq(schema.excecao.id, id));

    // PDV sem Cielo
    if (pag) {
      await tx.insert(schema.excecao).values({
        filialId: exc.filialId,
        processo: exc.processo ?? PROCESSO_OPERADORA,
        pagamentoId: exc.pagamentoId,
        tipo: 'PDV_SEM_CIELO',
        severidade: 'ALTA',
        descricao: `${pedidoTxt} — ${pag.forma || 'sem forma'}, NSU ${pag.nsu ?? '—'}, sem venda correspondente na Cielo. (Rejeitou match automático)`,
        valor: String(pag.valor),
      });
    }
    // Cielo sem PDV
    if (ven) {
      await tx.insert(schema.excecao).values({
        filialId: exc.filialId,
        processo: exc.processo ?? PROCESSO_OPERADORA,
        vendaAdquirenteId: exc.vendaAdquirenteId,
        tipo: 'CIELO_SEM_PDV',
        severidade: 'ALTA',
        descricao: `Venda na Cielo (NSU ${ven.nsu}, R$ ${Number(ven.valorBruto).toFixed(2)}) sem pagamento no PDV. (Rejeitou match automático)`,
        valor: String(ven.valorBruto),
      });
    }
  });

  return NextResponse.json({ ok: true });
}
