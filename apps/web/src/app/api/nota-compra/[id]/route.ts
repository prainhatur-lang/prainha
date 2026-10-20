// DELETE /api/nota-compra/[id]
// Apaga uma nota fiscal de entrada e reverte tudo que ela criou no estoque.
// Comportamento:
//  1. Busca todos os movimento_estoque criados a partir dessa nota (via
//     notaCompraItemId ∈ itens da nota).
//  2. Por produto, soma a quantidade lançada e CHECA SE NAO FICA NEGATIVO.
//     Se o produto ja teve saidas que consumiram esse lote (ex: vendas
//     desde o lancamento), a reversao deixaria estoque negativo — recusa.
//  3. Se OK: deleta os movimentos, ajusta produto.estoqueAtual subtraindo
//     a quantidade lancada. precoCusto NAO eh recalculado (seria caro
//     percorrer todo o historico) — fica como esta e o proximo MPM ajusta.
//  4. Deleta a nota (cascade ON DELETE remove notaCompraItem).
//
// O QUE NAO MUDA:
//  - produto_fornecedor (mappings) ficam — o user provavelmente vai
//    re-importar a mesma nota, e os mappings (com fator) sao aproveitados.
//  - precoCusto do produto (custo medio) — fica congelado no valor pos-
//    -entrada. Aproximacao aceitavel se a nota for re-lancada logo apos.
//
// XML: o sistema atualmente nao salva o XML no Storage (so xmlHash).
// Logo, nao tem arquivo pra deletar; basta apagar o registro.

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { lerMotivo, registrarExclusao, resumoConta } from '@/lib/registro-exclusao';
import { ehAdmin } from '@/lib/usuario-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const _semPerm = await negarSemPerm(user.id, 'nota_compra.delete');
  if (_semPerm) return _semPerm;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const [nota] = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      chave: schema.notaCompra.chave,
      numero: schema.notaCompra.numero,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, nota.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Carrega itens da nota
  const itens = await db
    .select({ id: schema.notaCompraItem.id })
    .from(schema.notaCompraItem)
    .where(eq(schema.notaCompraItem.notaCompraId, id));

  const itemIds = itens.map((it) => it.id);

  // Busca movimentos criados pela nota (so se houver itens)
  const movimentos = itemIds.length > 0
    ? await db
        .select({
          id: schema.movimentoEstoque.id,
          produtoId: schema.movimentoEstoque.produtoId,
          quantidade: schema.movimentoEstoque.quantidade,
          tipo: schema.movimentoEstoque.tipo,
        })
        .from(schema.movimentoEstoque)
        .where(inArray(schema.movimentoEstoque.notaCompraItemId, itemIds))
    : [];

  // Agrupa por produto pra checar reversao
  const qtdPorProduto = new Map<string, number>();
  for (const m of movimentos) {
    if (m.tipo !== 'ENTRADA_COMPRA') continue;
    const q = Number(m.quantidade ?? 0);
    qtdPorProduto.set(m.produtoId, (qtdPorProduto.get(m.produtoId) ?? 0) + q);
  }

  // Valida que a reversao nao deixa estoque negativo
  if (qtdPorProduto.size > 0) {
    const produtoIds = Array.from(qtdPorProduto.keys());
    const produtos = await db
      .select({
        id: schema.produto.id,
        nome: schema.produto.nome,
        estoqueAtual: schema.produto.estoqueAtual,
      })
      .from(schema.produto)
      .where(inArray(schema.produto.id, produtoIds));

    const conflitos: { nome: string; atual: number; aReverter: number }[] = [];
    for (const p of produtos) {
      const aReverter = qtdPorProduto.get(p.id) ?? 0;
      const atual = Number(p.estoqueAtual ?? 0);
      // Tolerancia minima por arredondamento
      if (atual + 1e-6 < aReverter) {
        conflitos.push({
          nome: p.nome ?? '(sem nome)',
          atual,
          aReverter,
        });
      }
    }

    if (conflitos.length > 0) {
      return NextResponse.json(
        {
          error:
            'reversao deixaria estoque negativo — produtos ja tiveram saidas (vendas/producao) consumindo esse lote',
          conflitos,
        },
        { status: 409 },
      );
    }
  }

  // Verifica contas a pagar criadas pela nota: bloqueia se alguma ja foi paga.
  const contasNfe = await db
    .select({
      id: schema.contaPagar.id,
      valor: schema.contaPagar.valor,
      dataPagamento: schema.contaPagar.dataPagamento,
      parcela: schema.contaPagar.parcela,
    })
    .from(schema.contaPagar)
    .where(
      and(
        eq(schema.contaPagar.notaCompraId, id),
        eq(schema.contaPagar.origem, 'NFE'),
      ),
    );
  // Nota paga (dono 20/10/2026): ninguém exclui nota com pagamento lançado —
  // nem o administrador. Ele primeiro exclui o pagamento (estorno da baixa na
  // conta a pagar) e só depois a nota. E nota que já teve pagamento (mesmo
  // estornado) só o administrador exclui: senão quem lançou estorna a baixa
  // e apaga a nota. Olha todas as contas ligadas à nota, de qualquer origem.
  const contasDaNota = await db
    .select({
      id: schema.contaPagar.id,
      valor: schema.contaPagar.valor,
      valorPago: schema.contaPagar.valorPago,
      dataPagamento: schema.contaPagar.dataPagamento,
      parcela: schema.contaPagar.parcela,
    })
    .from(schema.contaPagar)
    .where(and(eq(schema.contaPagar.notaCompraId, id), isNull(schema.contaPagar.dataDelete)));
  if (contasDaNota.length > 0) {
    const contaIds = contasDaNota.map((c) => c.id);
    const comBaixa = new Set(
      (
        await db
          .selectDistinct({ id: schema.contaPagarBaixa.contaPagarId })
          .from(schema.contaPagarBaixa)
          .where(inArray(schema.contaPagarBaixa.contaPagarId, contaIds))
      ).map((b) => b.id),
    );
    const comPagamento = contasDaNota.filter(
      (c) => c.dataPagamento != null || Number(c.valorPago ?? 0) > 0 || comBaixa.has(c.id),
    );
    const admin = await ehAdmin(user.id);
    if (comPagamento.length > 0) {
      const total = comPagamento.reduce((s, c) => s + Number(c.valorPago ?? c.valor ?? 0), 0);
      const reais = total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return NextResponse.json(
        {
          error: admin
            ? `Essa nota já tem pagamento lançado (${comPagamento.length} conta(s), R$ ${reais}). Primeiro exclua o pagamento na conta a pagar e depois exclua a nota.`
            : `Essa nota já foi paga (${comPagamento.length} conta(s), R$ ${reais}). Só o administrador pode excluir nota paga — ele exclui primeiro o pagamento e depois a nota.`,
          contasPagas: comPagamento.map((c) => ({ parcela: c.parcela, valor: Number(c.valor) })),
        },
        { status: admin ? 409 : 403 },
      );
    }
    if (!admin) {
      const [estorno] = await db
        .select({ resumo: schema.registroExclusao.resumo })
        .from(schema.registroExclusao)
        .where(
          and(
            eq(schema.registroExclusao.tabela, 'conta_pagar_baixa'),
            inArray(sql`${schema.registroExclusao.dados}->>'contaPagarId'`, contaIds),
          ),
        )
        .limit(1);
      if (estorno) {
        return NextResponse.json(
          {
            error: `Essa nota já teve pagamento, que foi excluído (${estorno.resumo ?? 'estorno registrado'}). Só o administrador pode excluir essa nota.`,
          },
          { status: 403 },
        );
      }
    }
  }

  const pagas = contasNfe.filter((c) => c.dataPagamento != null);
  if (pagas.length > 0) {
    return NextResponse.json(
      {
        error: `${pagas.length} conta(s) a pagar dessa nota ja foram pagas. Estorne o pagamento antes de excluir a nota.`,
        contasPagas: pagas.map((c) => ({ parcela: c.parcela, valor: Number(c.valor) })),
      },
      { status: 409 },
    );
  }

  // Registro de quem excluiu (20/10/2026): a nota e cada conta dela, com a
  // foto da linha. Se não registrar, não apaga.
  try {
    const motivo = await lerMotivo(req);
    const [notaFoto] = await db.select().from(schema.notaCompra).where(eq(schema.notaCompra.id, id)).limit(1);
    const quemNota = notaFoto?.emitNome ?? null;
    await registrarExclusao({
      tabela: 'nota_compra',
      registroId: id,
      filialId: nota.filialId,
      usuarioId: user.id,
      motivo,
      resumo: `NF ${nota.numero ?? '?'}${quemNota ? ` · ${quemNota}` : ''} · chave ${nota.chave ?? '?'}`,
      dados: notaFoto ?? null,
    });
    if (contasNfe.length > 0) {
      const fotos = await db
        .select()
        .from(schema.contaPagar)
        .where(and(eq(schema.contaPagar.notaCompraId, id), eq(schema.contaPagar.origem, 'NFE')));
      for (const c of fotos) {
        await registrarExclusao({
          tabela: 'conta_pagar',
          registroId: c.id,
          filialId: c.filialId,
          usuarioId: user.id,
          motivo: `nota NF ${nota.numero ?? '?'} excluída${motivo ? `: ${motivo}` : ''}`,
          resumo: resumoConta(quemNota ?? c.descricao, c.dataVencimento, c.valor),
          dados: c,
        });
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: `não consegui registrar a exclusão, nada foi apagado (${(e as Error).message})` },
      { status: 500 },
    );
  }

  // Reversao: subtrai estoque + apaga movimentos.
  for (const [produtoId, qtd] of qtdPorProduto.entries()) {
    await db
      .update(schema.produto)
      .set({
        estoqueAtual: sql`COALESCE(${schema.produto.estoqueAtual}, 0) - ${qtd.toFixed(4)}`,
      })
      .where(eq(schema.produto.id, produtoId));
  }

  if (movimentos.length > 0) {
    const movIds = movimentos.map((m) => m.id);
    await db
      .delete(schema.movimentoEstoque)
      .where(inArray(schema.movimentoEstoque.id, movIds));
  }

  // Apaga as contas a pagar nao pagas dessa nota
  if (contasNfe.length > 0) {
    await db
      .delete(schema.contaPagar)
      .where(
        and(
          eq(schema.contaPagar.notaCompraId, id),
          eq(schema.contaPagar.origem, 'NFE'),
        ),
      );
  }

  // Deleta a nota — cascade apaga notaCompraItem e nota_compra_duplicata.
  await db.delete(schema.notaCompra).where(eq(schema.notaCompra.id, id));

  return NextResponse.json({
    ok: true,
    chave: nota.chave,
    numero: nota.numero,
    movimentosRevertidos: movimentos.length,
    produtosAjustados: qtdPorProduto.size,
    contasPagarRemovidas: contasNfe.length,
  });
}
