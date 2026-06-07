// POST /api/compras/pedidos/[id]/enviar-auto
// Envia o pedido de compra AUTOMATICAMENTE pro fornecedor via WhatsApp
// (template UTILIDADE WHATSAPP_PEDIDO_TEMPLATE). Marca como ENVIADO.

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { pedidoCompraConfigurado, enviarPedidoCompra } from '@/lib/whatsapp-otp';

export const runtime = 'nodejs';

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function normTelefone(v: string | null): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) d = '55' + d;
  return d;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'pedido_compra.enviar');
  if (semPerm) return semPerm;

  if (!pedidoCompraConfigurado()) {
    return NextResponse.json(
      { error: 'Envio automático não configurado (falta WHATSAPP_PEDIDO_TEMPLATE). Use o 📲 wa.me.' },
      { status: 400 },
    );
  }

  const { id } = await params;
  const [p] = await db
    .select({
      id: schema.pedidoCompra.id,
      numero: schema.pedidoCompra.numero,
      valorTotal: schema.pedidoCompra.valorTotal,
      filialNome: schema.filial.nome,
      fornecedorNome: schema.fornecedor.nome,
      fornecedorFone: schema.fornecedor.fonePrincipal,
    })
    .from(schema.pedidoCompra)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.pedidoCompra.filialId))
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.pedidoCompra.fornecedorId))
    .where(eq(schema.pedidoCompra.id, id))
    .limit(1);
  if (!p) return NextResponse.json({ error: 'pedido nao encontrado' }, { status: 404 });

  const tel = normTelefone(p.fornecedorFone);
  if (!tel) return NextResponse.json({ error: 'fornecedor sem telefone' }, { status: 400 });

  const itens = await db
    .select({
      quantidade: schema.pedidoCompraItem.quantidade,
      precoUnitario: schema.pedidoCompraItem.precoUnitario,
      valorTotal: schema.pedidoCompraItem.valorTotal,
      produtoNome: schema.produto.nome,
      unidade: schema.produto.unidadeEstoque,
    })
    .from(schema.pedidoCompraItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.pedidoCompraItem.produtoId))
    .where(eq(schema.pedidoCompraItem.pedidoCompraId, id));

  // Itens numa unica linha (sem quebra): "Salmão 5 un = R$45,00; Camarão 2 kg = R$80,00"
  const itensStr = itens
    .map((i) => `${i.produtoNome} ${Number(i.quantidade).toLocaleString('pt-BR')} ${i.unidade} = ${brl(Number(i.valorTotal))}`)
    .join('; ');

  try {
    await enviarPedidoCompra(tel, {
      fornecedor: (p.fornecedorNome ?? '').split(' ')[0] || 'tudo bem',
      filial: p.filialNome ?? 'Prainha',
      numero: String(p.numero),
      itens: itensStr || '(itens no sistema)',
      total: p.valorTotal != null ? brl(Number(p.valorTotal)) : '—',
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  await db
    .update(schema.pedidoCompra)
    .set({ status: 'ENVIADO', enviadoEm: sql`now()` })
    .where(and(eq(schema.pedidoCompra.id, id), sql`${schema.pedidoCompra.status} <> 'CANCELADO'`));

  return NextResponse.json({ ok: true });
}
