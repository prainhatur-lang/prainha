// POST /api/ingest/pdv
// Endpoint chamado pelo agente local pra enviar dados do PDV:
// Produtos, Pedidos, PedidoItens. Upsert idempotente por
// (filial_id, codigo_externo).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { processarBaixaEstoque } from './baixa-estoque';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ProdutoSchema = z.object({
  codigoExterno: z.number().int(),
  nome: z.string().nullable(),
  descricao: z.string().nullable(),
  codigoPersonalizado: z.string().nullable(),
  codigoEtiqueta: z.string().nullable(),
  precoVenda: z.number().nullable(),
  precoCusto: z.number().nullable(),
  estoqueAtual: z.number().nullable(),
  estoqueMinimo: z.number().nullable(),
  estoqueControlado: z.boolean().nullable(),
  descontinuado: z.boolean().nullable(),
  itemPorKg: z.boolean().nullable(),
  codigoUnidadeComercial: z.number().int().nullable(),
  codigoProdutoTipo: z.number().int().nullable(),
  codigoCozinha: z.number().int().nullable(),
  ncm: z.string().nullable(),
  cfop: z.string().nullable(),
  cest: z.string().nullable(),
  versaoReg: z.number().int().nullable(),
  dataPausado: z.string().nullable().optional(),
});

const PedidoSchema = z.object({
  codigoExterno: z.number().int(),
  numero: z.number().int().nullable(),
  senha: z.string().nullable(),
  codigoClienteContatoExterno: z.number().int().nullable(),
  codigoClienteFiadoExterno: z.number().int().nullable(),
  nomeCliente: z.string().nullable(),
  codigoColaborador: z.number().int().nullable(),
  codigoUsuarioCriador: z.number().int().nullable(),
  dataAbertura: z.string().nullable(),
  dataFechamento: z.string().nullable(),
  valorTotal: z.number().nullable(),
  valorTotalItens: z.number().nullable(),
  subtotalPago: z.number().nullable(),
  totalDesconto: z.number().nullable(),
  percentualDesconto: z.number().nullable(),
  totalAcrescimo: z.number().nullable(),
  totalServico: z.number().nullable(),
  percentualTaxaServico: z.number().nullable(),
  valorEntrega: z.number().nullable(),
  valorTroco: z.number().nullable(),
  valorIva: z.number().nullable(),
  quantidadePessoas: z.number().int().nullable(),
  notaEmitida: z.boolean().nullable(),
  tag: z.string().nullable(),
  codigoPedidoOrigem: z.number().int().nullable(),
  codigoCupom: z.number().int().nullable(),
  dataDelete: z.string().nullable(),
  versaoReg: z.number().int().nullable(),
});

const PedidoItemSchema = z.object({
  codigoExterno: z.number().int(),
  codigoPedidoExterno: z.number().int(),
  codigoProdutoExterno: z.number().int().nullable(),
  nomeProduto: z.string().nullable(),
  quantidade: z.number().nullable(),
  valorUnitario: z.number().nullable(),
  precoCusto: z.number().nullable(),
  valorItem: z.number().nullable(),
  valorComplemento: z.number().nullable(),
  valorFilho: z.number().nullable(),
  valorDesconto: z.number().nullable(),
  valorGorjeta: z.number().nullable(),
  valorTotal: z.number().nullable(),
  codigoPai: z.number().int().nullable(),
  codigoItemPedidoTipo: z.number().int().nullable(),
  codigoPagamento: z.number().int().nullable(),
  codigoColaborador: z.number().int().nullable(),
  dataHoraCadastro: z.string().nullable(),
  dataDelete: z.string().nullable(),
  detalhes: z.string().nullable(),
  versaoReg: z.number().int().nullable(),
});

const BodySchema = z.object({
  produtos: z.array(ProdutoSchema).max(2000).optional(),
  pedidos: z.array(PedidoSchema).max(2000).optional(),
  pedidoItens: z.array(PedidoItemSchema).max(2000).optional(),
});

const CHUNK_SIZE = 500;

function toNumStr(v: number | null | undefined): string | null {
  return v == null ? null : String(v);
}

/** Trunca string nullable pra evitar 500 em varchar com tamanho fixo. */
function truncar(v: string | null | undefined, max: number): string | null {
  if (v == null) return null;
  return v.length > max ? v.slice(0, max) : v;
}

/** Converte string ISO em Date, ou null se invalida. Evita "Invalid Date" indo pro PG. */
function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Mapeia CODIGOPRODUTOTIPO do Consumer pro tipo da nuvem.
 *  Valores do Consumer:
 *   1 = Produto    -> VENDA_SIMPLES
 *   2 = Insumo     -> INSUMO
 *   3 = Complemento -> COMPLEMENTO
 *   4 = Combo      -> COMBO
 *   5 = Produto por Tamanho -> VARIANTE
 *   6 = Serviço    -> SERVICO
 *   null/outro    -> VENDA_SIMPLES (default)
 */
function mapearTipo(codigoProdutoTipo: number | null | undefined): string {
  switch (codigoProdutoTipo) {
    case 2:
      return 'INSUMO';
    case 3:
      return 'COMPLEMENTO';
    case 4:
      return 'COMBO';
    case 5:
      return 'VARIANTE';
    case 6:
      return 'SERVICO';
    case 1:
    default:
      return 'VENDA_SIMPLES';
  }
}

/** Deriva controlaEstoque do tipo + flag do Consumer. */
function deriveControlaEstoque(
  tipo: string,
  estoqueControladoConsumer: boolean | null | undefined,
): boolean {
  if (tipo === 'SERVICO') return false;
  if (tipo === 'VARIANTE') return false; // o pai não baixa; os filhos sim
  if (tipo === 'INSUMO') return true;
  // VENDA_SIMPLES / COMPLEMENTO / COMBO: respeita o Consumer quando informado
  return estoqueControladoConsumer ?? true;
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[ingest/pdv] erro nao tratado:', msg, stack);
    return NextResponse.json(
      { error: 'internal', message: msg.slice(0, 500) },
      { status: 500 },
    );
  }
}

async function handle(req: Request) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = auth.slice(7);
  if (!token.startsWith('agt_')) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 });
  }

  const [filial] = await db
    .select({ id: schema.filial.id })
    .from(schema.filial)
    .where(eq(schema.filial.agenteToken, token))
    .limit(1);
  if (!filial) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await db
    .update(schema.filial)
    .set({ ultimoPing: new Date() })
    .where(eq(schema.filial.id, filial.id));

  const { produtos, pedidos, pedidoItens } = parsed.data;
  let produtosRecebidos = 0;
  let pedidosRecebidos = 0;
  let pedidoItensRecebidos = 0;
  let estoqueBaixados = 0;
  let estoqueRevertidos = 0;

  if (produtos?.length) {
    const rows = produtos.map((p) => {
      const tipo = mapearTipo(p.codigoProdutoTipo);
      return {
        filialId: filial.id,
        codigoExterno: p.codigoExterno,
        nome: truncar(p.nome, 200),
        descricao: p.descricao,
        codigoPersonalizado: truncar(p.codigoPersonalizado, 50),
        codigoEtiqueta: truncar(p.codigoEtiqueta, 50),
        precoVenda: toNumStr(p.precoVenda),
        precoCusto: toNumStr(p.precoCusto),
        estoqueAtual: toNumStr(p.estoqueAtual),
        estoqueMinimo: toNumStr(p.estoqueMinimo),
        estoqueControlado: p.estoqueControlado,
        descontinuado: p.descontinuado,
        itemPorKg: p.itemPorKg,
        codigoUnidadeComercial: p.codigoUnidadeComercial,
        codigoProdutoTipo: p.codigoProdutoTipo,
        codigoCozinha: p.codigoCozinha,
        ncm: truncar(p.ncm, 10),
        cfop: truncar(p.cfop, 10),
        cest: truncar(p.cest, 10),
        tipo,
        unidadeEstoque: p.itemPorKg ? 'kg' : 'un',
        controlaEstoque: deriveControlaEstoque(tipo, p.estoqueControlado),
        criadoNaNuvem: false,
        dataPausado: toDate(p.dataPausado),
        versaoReg: p.versaoReg,
        sincronizadoEm: new Date(),
      };
    });
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await db
        .insert(schema.produto)
        .values(rows.slice(i, i + CHUNK_SIZE))
        .onConflictDoUpdate({
          target: [schema.produto.filialId, schema.produto.codigoExterno],
          set: {
            nome: drizzleSql`excluded.nome`,
            descricao: drizzleSql`excluded.descricao`,
            codigoPersonalizado: drizzleSql`excluded.codigo_personalizado`,
            codigoEtiqueta: drizzleSql`excluded.codigo_etiqueta`,
            precoVenda: drizzleSql`excluded.preco_venda`,
            // ATENCAO: NAO sobrescrever precoCusto e estoqueAtual no UPDATE.
            // Esses dois campos sao gerenciados na nuvem via movimento_estoque
            // (ENTRADA_COMPRA da NFe, ENTRADA/SAIDA_PRODUCAO de OPs, SAIDA_VENDA
            // / SAIDA_FICHA_TECNICA das vendas, ajustes manuais). Se sobrescre-
            // vessemos com o valor do Consumer, teriamos dupla contagem (porque
            // o Consumer ja considera as vendas no proprio saldo, e a baixa
            // automatica na nuvem subtrai de novo).
            // O estoque inicial vem so na primeira sync (INSERT), depois eh
            // imutavel pra essa rota — o que se atualiza eh metadata.
            estoqueMinimo: drizzleSql`excluded.estoque_minimo`,
            estoqueControlado: drizzleSql`excluded.estoque_controlado`,
            descontinuado: drizzleSql`excluded.descontinuado`,
            itemPorKg: drizzleSql`excluded.item_por_kg`,
            codigoUnidadeComercial: drizzleSql`excluded.codigo_unidade_comercial`,
            codigoProdutoTipo: drizzleSql`excluded.codigo_produto_tipo`,
            codigoCozinha: drizzleSql`excluded.codigo_cozinha`,
            ncm: drizzleSql`excluded.ncm`,
            cfop: drizzleSql`excluded.cfop`,
            cest: drizzleSql`excluded.cest`,
            dataPausado: drizzleSql`excluded.data_pausado`,
            versaoReg: drizzleSql`excluded.versao_reg`,
            sincronizadoEm: drizzleSql`excluded.sincronizado_em`,
          },
        });
    }
    produtosRecebidos = rows.length;
  }

  if (pedidos?.length) {
    const rows = pedidos.map((p) => ({
      filialId: filial.id,
      codigoExterno: p.codigoExterno,
      numero: p.numero,
      senha: truncar(p.senha, 30),
      codigoClienteContatoExterno: p.codigoClienteContatoExterno,
      codigoClienteFiadoExterno: p.codigoClienteFiadoExterno,
      nomeCliente: truncar(p.nomeCliente, 200),
      codigoColaborador: p.codigoColaborador,
      codigoUsuarioCriador: p.codigoUsuarioCriador,
      dataAbertura: toDate(p.dataAbertura),
      dataFechamento: toDate(p.dataFechamento),
      valorTotal: toNumStr(p.valorTotal),
      valorTotalItens: toNumStr(p.valorTotalItens),
      subtotalPago: toNumStr(p.subtotalPago),
      totalDesconto: toNumStr(p.totalDesconto),
      percentualDesconto: toNumStr(p.percentualDesconto),
      totalAcrescimo: toNumStr(p.totalAcrescimo),
      totalServico: toNumStr(p.totalServico),
      percentualTaxaServico: toNumStr(p.percentualTaxaServico),
      valorEntrega: toNumStr(p.valorEntrega),
      valorTroco: toNumStr(p.valorTroco),
      valorIva: toNumStr(p.valorIva),
      quantidadePessoas: p.quantidadePessoas,
      notaEmitida: p.notaEmitida,
      tag: truncar(p.tag, 100),
      codigoPedidoOrigem: p.codigoPedidoOrigem,
      codigoCupom: p.codigoCupom,
      dataDelete: toDate(p.dataDelete),
      versaoReg: p.versaoReg,
      sincronizadoEm: new Date(),
    }));
    // Quando o batch da overflow ou outro erro de coluna, o Postgres rejeita
    // o batch inteiro sem dizer qual row. Pra debugar, em caso de erro
    // re-executamos de 1 em 1 pra identificar exatamente qual codigoExterno
    // e qual valor estourou. Loga e segue (resto do batch ainda entra).
    const inserirPedido = (chunk: typeof rows) =>
      db
        .insert(schema.pedido)
        .values(chunk)
        .onConflictDoUpdate({
          target: [schema.pedido.filialId, schema.pedido.codigoExterno],
          set: {
            numero: drizzleSql`excluded.numero`,
            senha: drizzleSql`excluded.senha`,
            codigoClienteContatoExterno: drizzleSql`excluded.codigo_cliente_contato_externo`,
            codigoClienteFiadoExterno: drizzleSql`excluded.codigo_cliente_fiado_externo`,
            nomeCliente: drizzleSql`excluded.nome_cliente`,
            codigoColaborador: drizzleSql`excluded.codigo_colaborador`,
            codigoUsuarioCriador: drizzleSql`excluded.codigo_usuario_criador`,
            dataAbertura: drizzleSql`excluded.data_abertura`,
            dataFechamento: drizzleSql`excluded.data_fechamento`,
            valorTotal: drizzleSql`excluded.valor_total`,
            valorTotalItens: drizzleSql`excluded.valor_total_itens`,
            subtotalPago: drizzleSql`excluded.subtotal_pago`,
            totalDesconto: drizzleSql`excluded.total_desconto`,
            percentualDesconto: drizzleSql`excluded.percentual_desconto`,
            totalAcrescimo: drizzleSql`excluded.total_acrescimo`,
            totalServico: drizzleSql`excluded.total_servico`,
            percentualTaxaServico: drizzleSql`excluded.percentual_taxa_servico`,
            valorEntrega: drizzleSql`excluded.valor_entrega`,
            valorTroco: drizzleSql`excluded.valor_troco`,
            valorIva: drizzleSql`excluded.valor_iva`,
            quantidadePessoas: drizzleSql`excluded.quantidade_pessoas`,
            notaEmitida: drizzleSql`excluded.nota_emitida`,
            tag: drizzleSql`excluded.tag`,
            codigoPedidoOrigem: drizzleSql`excluded.codigo_pedido_origem`,
            codigoCupom: drizzleSql`excluded.codigo_cupom`,
            dataDelete: drizzleSql`excluded.data_delete`,
            versaoReg: drizzleSql`excluded.versao_reg`,
            sincronizadoEm: drizzleSql`excluded.sincronizado_em`,
          },
        });

    let pedidosFalhados = 0;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      try {
        await inserirPedido(chunk);
      } catch (err) {
        const msgBatch = err instanceof Error ? err.message : String(err);
        console.error(
          `[ingest/pdv] batch de ${chunk.length} pedidos falhou (${msgBatch.slice(0, 200)}). Tentando 1 a 1 pra isolar...`,
        );
        // Fallback: insere 1 a 1, loga qual codigo + valores numericos da row
        for (const row of chunk) {
          try {
            await inserirPedido([row]);
          } catch (errRow) {
            pedidosFalhados++;
            const msgRow = errRow instanceof Error ? errRow.message : String(errRow);
            console.error(
              `[ingest/pdv] pedido codigo=${row.codigoExterno} falhou: ${msgRow.slice(0, 200)}`,
              {
                valorTotal: row.valorTotal,
                valorTotalItens: row.valorTotalItens,
                subtotalPago: row.subtotalPago,
                totalDesconto: row.totalDesconto,
                percentualDesconto: row.percentualDesconto,
                totalAcrescimo: row.totalAcrescimo,
                totalServico: row.totalServico,
                percentualTaxaServico: row.percentualTaxaServico,
                valorEntrega: row.valorEntrega,
                valorTroco: row.valorTroco,
                valorIva: row.valorIva,
              },
            );
            // Continua — proximo pedido pode ser ok
          }
        }
      }
    }
    pedidosRecebidos = rows.length - pedidosFalhados;
    if (pedidosFalhados > 0) {
      console.warn(`[ingest/pdv] ${pedidosFalhados} de ${rows.length} pedidos foram pulados por erro`);
    }
  }

  if (pedidoItens?.length) {
    const rows = pedidoItens.map((it) => ({
      filialId: filial.id,
      codigoExterno: it.codigoExterno,
      codigoPedidoExterno: it.codigoPedidoExterno,
      codigoProdutoExterno: it.codigoProdutoExterno,
      nomeProduto: truncar(it.nomeProduto, 200),
      quantidade: toNumStr(it.quantidade),
      valorUnitario: toNumStr(it.valorUnitario),
      precoCusto: toNumStr(it.precoCusto),
      valorItem: toNumStr(it.valorItem),
      valorComplemento: toNumStr(it.valorComplemento),
      valorFilho: toNumStr(it.valorFilho),
      valorDesconto: toNumStr(it.valorDesconto),
      valorGorjeta: toNumStr(it.valorGorjeta),
      valorTotal: toNumStr(it.valorTotal),
      codigoPai: it.codigoPai,
      codigoItemPedidoTipo: it.codigoItemPedidoTipo,
      codigoPagamento: it.codigoPagamento,
      codigoColaborador: it.codigoColaborador,
      dataHoraCadastro: toDate(it.dataHoraCadastro),
      dataDelete: toDate(it.dataDelete),
      detalhes: it.detalhes,
      versaoReg: it.versaoReg,
      sincronizadoEm: new Date(),
    }));
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await db
        .insert(schema.pedidoItem)
        .values(rows.slice(i, i + CHUNK_SIZE))
        .onConflictDoUpdate({
          target: [schema.pedidoItem.filialId, schema.pedidoItem.codigoExterno],
          set: {
            codigoPedidoExterno: drizzleSql`excluded.codigo_pedido_externo`,
            codigoProdutoExterno: drizzleSql`excluded.codigo_produto_externo`,
            nomeProduto: drizzleSql`excluded.nome_produto`,
            quantidade: drizzleSql`excluded.quantidade`,
            valorUnitario: drizzleSql`excluded.valor_unitario`,
            precoCusto: drizzleSql`excluded.preco_custo`,
            valorItem: drizzleSql`excluded.valor_item`,
            valorComplemento: drizzleSql`excluded.valor_complemento`,
            valorFilho: drizzleSql`excluded.valor_filho`,
            valorDesconto: drizzleSql`excluded.valor_desconto`,
            valorGorjeta: drizzleSql`excluded.valor_gorjeta`,
            valorTotal: drizzleSql`excluded.valor_total`,
            codigoPai: drizzleSql`excluded.codigo_pai`,
            codigoItemPedidoTipo: drizzleSql`excluded.codigo_item_pedido_tipo`,
            codigoPagamento: drizzleSql`excluded.codigo_pagamento`,
            codigoColaborador: drizzleSql`excluded.codigo_colaborador`,
            dataHoraCadastro: drizzleSql`excluded.data_hora_cadastro`,
            dataDelete: drizzleSql`excluded.data_delete`,
            detalhes: drizzleSql`excluded.detalhes`,
            versaoReg: drizzleSql`excluded.versao_reg`,
            sincronizadoEm: drizzleSql`excluded.sincronizado_em`,
          },
        });
    }
    pedidoItensRecebidos = rows.length;

    // Resolve FKs pedido_id + produto_id
    await db.execute(drizzleSql`
      UPDATE pedido_item pi SET pedido_id = p.id
      FROM pedido p
      WHERE pi.filial_id = ${filial.id}
        AND pi.filial_id = p.filial_id
        AND pi.codigo_pedido_externo = p.codigo_externo
        AND pi.pedido_id IS NULL
    `);
    await db.execute(drizzleSql`
      UPDATE pedido_item pi SET produto_id = pr.id
      FROM produto pr
      WHERE pi.filial_id = ${filial.id}
        AND pi.filial_id = pr.filial_id
        AND pi.codigo_produto_externo = pr.codigo_externo
        AND pi.produto_id IS NULL
        AND pi.codigo_produto_externo IS NOT NULL
    `);

    // Baixa automática de estoque pra os itens recém-ingeridos.
    // Idempotente: não cria duplicado se o item já foi processado.
    // Reverte se o item tiver sido deletado no Consumer.
    try {
      const codigosExternos = pedidoItens.map((it) => it.codigoExterno);
      const r = await processarBaixaEstoque(filial.id, codigosExternos);
      estoqueBaixados = r.baixados;
      estoqueRevertidos = r.revertidos;
    } catch (err) {
      // Loga mas não quebra o ingest — baixa pode ser reprocessada em próxima rodada.
      console.error('[ingest/pdv] falha ao processar baixa de estoque:', err);
    }
  }

  return NextResponse.json({
    produtosRecebidos,
    pedidosRecebidos,
    pedidoItensRecebidos,
    estoqueBaixados,
    estoqueRevertidos,
  });
}
