// POST /api/cotacao/[id]/aprovar
// Calcula alocacao final via lib calcularAlocacaoCotacao (1 colocado +
// reassign se nao atinge valor minimo do fornecedor) e gera 1 pedido_compra
// por fornecedor vencedor. Atualiza cotacao.status=APROVADA e
// cotacao_item.resposta_vencedora_id.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq, max } from 'drizzle-orm';
import { calcularAlocacaoCotacao } from '@/lib/cotacao-alocacao';
import { pedidoCompraConfigurado } from '@/lib/whatsapp-otp';
import { enviarPedidoAuto } from '@/lib/enviar-pedido';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: cotacaoId } = await params;

  const [cot] = await db
    .select()
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, cotacaoId))
    .limit(1);
  if (!cot) return NextResponse.json({ error: 'cotacao nao encontrada' }, { status: 404 });
  if (cot.status === 'APROVADA' || cot.status === 'CONCLUIDA') {
    return NextResponse.json({ error: 'ja aprovada' }, { status: 400 });
  }
  if (cot.status === 'CANCELADA') {
    return NextResponse.json({ error: 'cotacao cancelada' }, { status: 400 });
  }

  // Calcula alocacao usando a mesma lib que a tela de preview chama.
  // Garante que preview = resultado real da aprovacao.
  const alocacao = await calcularAlocacaoCotacao(cotacaoId);

  if (alocacao.porFornecedor.length === 0) {
    return NextResponse.json(
      { error: 'nenhum fornecedor com itens vencedores (sem respostas com preco)' },
      { status: 400 },
    );
  }

  // Atualiza cotacao_item.resposta_vencedora_id pra cada item alocado
  for (const f of alocacao.porFornecedor) {
    for (const it of f.itens) {
      await db
        .update(schema.cotacaoItem)
        .set({ respostaVencedoraId: it.respostaId })
        .where(eq(schema.cotacaoItem.id, it.itemId));
    }
  }

  // Gera 1 pedido_compra por fornecedor vencedor
  const pedidosCriados: Array<{ id: string; numero: number; fornecedorId: string }> = [];
  for (const f of alocacao.porFornecedor) {
    const [{ ult }] = await db
      .select({ ult: max(schema.pedidoCompra.numero) })
      .from(schema.pedidoCompra)
      .where(eq(schema.pedidoCompra.filialId, cot.filialId));
    const numero = (ult ?? 0) + 1;

    const [{ pedidoId }] = await db
      .insert(schema.pedidoCompra)
      .values({
        filialId: cot.filialId,
        cotacaoId,
        fornecedorId: f.fornecedorId,
        numero,
        status: 'GERADO',
        valorTotal: f.total.toFixed(2),
      })
      .returning({ pedidoId: schema.pedidoCompra.id });

    await db.insert(schema.pedidoCompraItem).values(
      f.itens.map((it) => ({
        pedidoCompraId: pedidoId,
        produtoId: it.produtoId,
        respostaVencedoraId: it.respostaId,
        quantidade: it.qtd,
        unidade: it.unidade,
        marcaId: it.marcaId,
        precoUnitario: it.preco.toFixed(4),
        valorTotal: it.precoTotal.toFixed(2),
      })),
    );

    pedidosCriados.push({ id: pedidoId, numero, fornecedorId: f.fornecedorId });
  }

  // Atualiza status da cotacao
  await db
    .update(schema.cotacao)
    .set({ status: 'APROVADA', aprovadaEm: new Date(), aprovadaPor: user.id })
    .where(eq(schema.cotacao.id, cotacaoId));

  // Envia AUTOMATICAMENTE cada pedido gerado pro fornecedor (quando o WhatsApp
  // de pedido esta configurado). Resiliente: falha de um envio nao derruba a
  // aprovacao — o pedido fica GERADO e pode ser reenviado na tela de pedidos.
  let enviados = 0;
  const falhasEnvio: Array<{ numero: number; error: string }> = [];
  if (pedidoCompraConfigurado()) {
    for (const ped of pedidosCriados) {
      try {
        const r = await enviarPedidoAuto(ped.id);
        if (r.ok) enviados++;
        else falhasEnvio.push({ numero: ped.numero, error: r.error ?? 'falha' });
      } catch (e) {
        falhasEnvio.push({ numero: ped.numero, error: (e as Error).message });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    pedidos: pedidosCriados,
    enviados,
    envioConfigurado: pedidoCompraConfigurado(),
    falhasEnvio,
    reassigned: alocacao.reassignados.length,
    orfaos: alocacao.orfaos.length,
    totalGeral: alocacao.totalGeral,
    detalheReassign: alocacao.reassignados,
    detalheOrfaos: alocacao.orfaos,
  });
}
