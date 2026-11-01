// Estoque e financeiro da Lelis (01/11/2026).
// Entrada de nota de compra → estoque (+) e contas a pagar (duplicatas).
// NF-e de venda autorizada → estoque (−) e contas a receber.
// Cancelamento da venda → estorno do estoque e o a receber cancelado.
// Tudo idempotente pelos índices únicos de migrate-lelis-entrada.

import { db, schema } from '@concilia/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { dateToBrYmd, diasAtrasBr, hojeBr } from '@/lib/datas';
import { chaveProduto, sincronizarProdutosDasNotas } from './sincronizar';

export interface EntradaResultado {
  itens: number;
  semProduto: number;
  contas: number;
  jaTinha: boolean;
}

/** Dá entrada na nota de compra da Lelis: estoque + contas a pagar. */
export async function darEntradaNotaLelis(filialId: string, notaId: string, usuario: string): Promise<EntradaResultado | { erro: string }> {
  const [nota] = await db
    .select()
    .from(schema.notaCompra)
    .where(and(eq(schema.notaCompra.id, notaId), eq(schema.notaCompra.filialId, filialId)))
    .limit(1);
  if (!nota) return { erro: 'nota não encontrada' };

  // produtos e tributação da saída a partir dessa nota (e das outras)
  await sincronizarProdutosDasNotas(filialId, usuario);

  const itens = await db
    .select()
    .from(schema.notaCompraItem)
    .where(eq(schema.notaCompraItem.notaCompraId, notaId));
  const prods = await db
    .select({ id: schema.revendaProduto.id, chave: schema.revendaProduto.chave })
    .from(schema.revendaProduto)
    .where(eq(schema.revendaProduto.filialId, filialId));
  const porChave = new Map(prods.map((p) => [p.chave, p.id]));

  let novos = 0;
  let semProduto = 0;
  for (const it of itens) {
    const qtd = Number(it.quantidade) || 0;
    if (qtd <= 0) continue;
    const pid = porChave.get(chaveProduto(it.ean, nota.emitCnpj, it.codigoProdutoFornecedor, it.descricao));
    if (!pid) { semProduto++; continue; }
    const custo = ((Number(it.valorTotal) || 0) - (Number(it.valorDesconto) || 0)) / qtd;
    const r = await db.execute(sql`
      INSERT INTO revenda_movimento (filial_id, revenda_produto_id, tipo, quantidade, custo_unit, nota_compra_item_id, observacao, criado_por)
      VALUES (${filialId}::uuid, ${pid}::uuid, 'ENTRADA_COMPRA', ${String(qtd)}::numeric, ${custo.toFixed(4)}::numeric,
              ${it.id}::uuid, ${`NF-e ${nota.numero ?? ''} — ${nota.emitNome ?? ''}`.slice(0, 200)}, ${usuario})
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    if ((r as unknown as unknown[]).length) novos++;
  }

  // contas a pagar das duplicatas (ou uma só, no total da nota, se não vier cobrança)
  const dups = await db
    .select()
    .from(schema.notaCompraDuplicata)
    .where(and(eq(schema.notaCompraDuplicata.notaCompraId, notaId), isNull(schema.notaCompraDuplicata.contaPagarId)));
  const [jaConta] = await db
    .select({ id: schema.contaPagar.id })
    .from(schema.contaPagar)
    .where(and(eq(schema.contaPagar.filialId, filialId), eq(schema.contaPagar.notaCompraId, notaId)))
    .limit(1);
  let contas = 0;
  const desc = `NFe nº ${nota.numero ?? ''} — ${nota.emitNome ?? ''}`.trim();
  if (dups.length) {
    const [{ total }] = (await db.execute(sql`
      SELECT count(*)::int AS total FROM nota_compra_duplicata WHERE nota_compra_id = ${notaId}::uuid
    `)) as unknown as { total: number }[];
    for (const [i, d] of dups.entries()) {
      const [c] = await db
        .insert(schema.contaPagar)
        .values({
          filialId,
          criadoEm: new Date(),
          origem: 'NFE',
          notaCompraId: notaId,
          fornecedorId: nota.fornecedorId,
          parcela: i + 1,
          totalParcelas: total,
          dataVencimento: d.dataVencimento,
          valor: d.valor,
          descricao: total > 1 ? `${desc} (${d.numero ?? i + 1}/${total})` : desc,
        })
        .returning({ id: schema.contaPagar.id });
      await db.update(schema.notaCompraDuplicata).set({ contaPagarId: c.id }).where(eq(schema.notaCompraDuplicata.id, d.id));
      contas++;
    }
  } else if (!jaConta && Number(nota.valorTotal) > 0) {
    const temDup = (await db.execute(sql`
      SELECT 1 FROM nota_compra_duplicata WHERE nota_compra_id = ${notaId}::uuid LIMIT 1
    `)) as unknown as unknown[];
    if (!temDup.length) {
      await db.insert(schema.contaPagar).values({
        filialId,
        criadoEm: new Date(),
        origem: 'NFE',
        notaCompraId: notaId,
        fornecedorId: nota.fornecedorId,
        parcela: 1,
        totalParcelas: 1,
        dataVencimento: nota.dataEmissao ? dateToBrYmd(nota.dataEmissao) : hojeBr(),
        valor: nota.valorTotal!,
        descricao: `${desc} (sem duplicata na nota — conferir vencimento)`,
      });
      contas++;
    }
  }

  if (!nota.dataEntrada) {
    await db.update(schema.notaCompra).set({ dataEntrada: new Date() }).where(eq(schema.notaCompra.id, notaId));
  }
  return { itens: novos, semProduto, contas, jaTinha: novos === 0 && contas === 0 };
}

/** Venda autorizada: baixa o estoque e lança o a receber (idempotente). */
export async function registrarVendaLelis(opts: {
  filialId: string;
  nfeId: string;
  numero: number | null;
  usuario: string;
  compradorDoc: string;
  compradorNome: string;
  formaPagamento: string;
  itens: { produtoId: string; quantidade: number; custoUnit: number }[];
  parcelas: { vencimento: string; valor: number }[];
}): Promise<void> {
  for (const it of opts.itens) {
    await db.execute(sql`
      INSERT INTO revenda_movimento (filial_id, revenda_produto_id, tipo, quantidade, custo_unit, nfe_emitida_id, observacao, criado_por)
      VALUES (${opts.filialId}::uuid, ${it.produtoId}::uuid, 'SAIDA_VENDA', ${String(-it.quantidade)}::numeric,
              ${it.custoUnit.toFixed(4)}::numeric, ${opts.nfeId}::uuid,
              ${`NF-e ${opts.numero ?? ''} — ${opts.compradorNome}`.slice(0, 200)}, ${opts.usuario})
      ON CONFLICT DO NOTHING
    `);
  }
  const total = opts.parcelas.length;
  for (const [i, p] of opts.parcelas.entries()) {
    await db.execute(sql`
      INSERT INTO revenda_receber (filial_id, nfe_emitida_id, comprador_doc, comprador_nome, descricao, parcela, total_parcelas,
                                   vencimento, valor, forma_pagamento, criado_por)
      VALUES (${opts.filialId}::uuid, ${opts.nfeId}::uuid, ${opts.compradorDoc.slice(0, 14)}, ${opts.compradorNome.slice(0, 200)},
              ${`NF-e ${opts.numero ?? ''}${total > 1 ? ` (${i + 1}/${total})` : ''}`}, ${i + 1}, ${total},
              ${p.vencimento}::date, ${p.valor.toFixed(2)}::numeric, ${opts.formaPagamento}, ${opts.usuario})
      ON CONFLICT DO NOTHING
    `);
  }
}

/** Venda cancelada: devolve o estoque e cancela o a receber em aberto. */
export async function estornarVendaLelis(filialId: string, nfeId: string, usuario: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO revenda_movimento (filial_id, revenda_produto_id, tipo, quantidade, custo_unit, nfe_emitida_id, observacao, criado_por)
    SELECT filial_id, revenda_produto_id, 'ESTORNO_VENDA', -quantidade, custo_unit, nfe_emitida_id,
           'Cancelamento da ' || coalesce(observacao, 'NF-e'), ${usuario}
      FROM revenda_movimento
     WHERE filial_id = ${filialId}::uuid AND nfe_emitida_id = ${nfeId}::uuid AND tipo = 'SAIDA_VENDA'
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    UPDATE revenda_receber SET cancelado = true
     WHERE filial_id = ${filialId}::uuid AND nfe_emitida_id = ${nfeId}::uuid AND recebido_em IS NULL
  `);
}

/** Parcelas padrão: uma só, hoje (boleto: 28 dias). */
export function parcelasPadrao(total: number, forma: string): { vencimento: string; valor: number }[] {
  const venc = forma === '15' ? diasAtrasBr(-28) : hojeBr();
  return [{ vencimento: venc, valor: Math.round(total * 100) / 100 }];
}

