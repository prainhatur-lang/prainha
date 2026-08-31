// Monta o payload da NFC-e a partir do ESPELHO Postgres (pedido/pedido_item/
// pagamento/movimento_conta_corrente), sem depender do Firebird da loja.
//
// Por que existe: até agora só o vendas-local sabia montar a nota, lendo o
// Firebird direto. Isso quer dizer que emitir exigia (a) estar na loja e (b)
// a loja de pé — se a VPN cai ou o pedido saiu da janela do caixa, não havia
// caminho. Aqui o painel monta sozinho, do que o CDC já trouxe.
//
// A regra de negócio é a MESMA de nfceDadosDoPedido() no vendas-local
// (server.mjs) — se mudar lá, muda aqui:
//  · vNF alvo = pedido.valorTotal (o que o cliente pagou de fato); o desconto
//    é recalibrado por cima dos itens pra fechar exato;
//  · serviço/acréscimo entram como vOutro no 1º item;
//  · fiado não tem linha em `pagamento` — vem de movimento_conta_corrente
//    como tPag 05 (Crédito Loja).
//
// LIMITE CONHECIDO: depende do CDC ter sincronizado o pedido (hoje a cada
// 15min). Pedido recém-fechado ainda não está aqui — nesse caso o caixa da
// loja continua sendo o caminho imediato.

import { db, schema } from '@concilia/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { EmitirInput } from './emitir';

/** Consumer.CODIGOFORMAPAGAMENTO -> tPag da NFe. Os códigos batem com o tPag
 *  até o 14 e divergem depois (Consumer 18=Pix Manual, 21=Pix Online), por
 *  isso o mapa é explícito. Espelha NFCE_TPAG do vendas-local, estendido. */
const TPAG_POR_DESCRICAO: Record<string, string> = {
  'Dinheiro': '01',
  'Cheque': '02',
  'Cartão de Crédito': '03',
  'Cartão de Débito': '04',
  'Crédito Loja': '05',
  'Vale Alimentação': '10',
  'Vale Refeição': '11',
  'Depósito Bancário': '16',
  'Pix Online': '17', // PIX dinâmico (cobrança gerada)
  'Transferência bancária, Carteira Digital': '18',
  'Programa de fidelidade, Cashback, Crédito Virtual': '19',
  'Pix Manual': '20', // PIX estático (chave fixa)
};

function tPagDe(descricao: string | null): string {
  return TPAG_POR_DESCRICAO[String(descricao ?? '').trim()] ?? '99';
}

function tBandDe(bandeira: string | null): string | undefined {
  const b = String(bandeira ?? '').toLowerCase();
  if (!b) return undefined;
  if (b.includes('visa')) return '01';
  if (b.includes('master')) return '02';
  if (b.includes('amex') || b.includes('american')) return '03';
  if (b.includes('diners')) return '05';
  if (b.includes('elo')) return '06';
  if (b.includes('hiper')) return '07';
  if (b.includes('cabal')) return '09';
  return '99';
}

const r2c = (v: number): number => Math.round(v * 100) / 100;
const num = (v: string | number | null): number => (v == null ? 0 : Number(v));

export interface MontarResultado {
  ok: boolean;
  erro?: string;
  input?: EmitirInput;
  /** Pra tela avisar antes de emitir. */
  resumo?: { mesa: string | null; total: number; itens: number; fiado: boolean };
}

/** Monta a nota de um pedido do espelho. `codigoExterno` é PEDIDOS.CODIGO. */
export async function montarNfceDoEspelho(
  filialId: string,
  codigoExterno: number,
): Promise<MontarResultado> {
  const [ped] = await db
    .select({
      numero: schema.pedido.numero,
      valorTotal: schema.pedido.valorTotal,
      totalServico: schema.pedido.totalServico,
      totalAcrescimo: schema.pedido.totalAcrescimo,
      dataFechamento: schema.pedido.dataFechamento,
    })
    .from(schema.pedido)
    .where(
      and(
        eq(schema.pedido.filialId, filialId),
        eq(schema.pedido.codigoExterno, codigoExterno),
        isNull(schema.pedido.dataDelete),
      ),
    )
    .limit(1);
  if (!ped) return { ok: false, erro: 'pedido não encontrado no espelho (o CDC pode não ter sincronizado ainda)' };
  if (!ped.dataFechamento) return { ok: false, erro: 'pedido ainda está aberto — feche a conta antes de emitir' };

  const alvo = r2c(num(ped.valorTotal));
  if (!(alvo > 0)) return { ok: false, erro: 'pedido sem valor' };

  // NCM/CFOP moram no cadastro de produto (o contador mantém no Consumer, o
  // CDC espelha). Item sem produto vinculado sai sem NCM — o emitir.ts aplica
  // o padrão da config fiscal da filial.
  const itensRaw = await db
    .select({
      codigoProduto: schema.pedidoItem.codigoProdutoExterno,
      nome: schema.pedidoItem.nomeProduto,
      quantidade: schema.pedidoItem.quantidade,
      valorTotal: schema.pedidoItem.valorTotal,
      ncm: schema.produto.ncm,
      cfop: schema.produto.cfop,
    })
    .from(schema.pedidoItem)
    .leftJoin(schema.produto, eq(schema.produto.id, schema.pedidoItem.produtoId))
    .where(
      and(
        eq(schema.pedidoItem.filialId, filialId),
        eq(schema.pedidoItem.codigoPedidoExterno, codigoExterno),
        isNull(schema.pedidoItem.dataDelete),
      ),
    )
    .orderBy(schema.pedidoItem.codigoExterno);

  const itens = itensRaw
    .map((r) => ({
      codigo: String(r.codigoProduto ?? ''),
      descricao: (r.nome ?? '').trim() || 'ITEM',
      quantidade: num(r.quantidade),
      valorTotal: r2c(num(r.valorTotal)),
      ncm: r.ncm ?? undefined,
      cfop: r.cfop ?? undefined,
    }))
    .filter((x) => x.quantidade > 0 && x.valorTotal > 0) as Array<
    EmitirInput['itens'][number] & { valorDesconto?: number; valorOutro?: number }
  >;
  if (!itens.length) return { ok: false, erro: 'pedido sem itens com valor' };

  // Recalibra pra fechar exato no valorTotal: o que sobra vira desconto
  // rateado; o que falta vira vOutro (serviço/acréscimo) no 1º item.
  const base = r2c(itens.reduce((s, x) => s + x.valorTotal, 0));
  let extra = r2c(num(ped.totalServico) + num(ped.totalAcrescimo));
  let desc = r2c(base + extra - alvo);
  if (desc < 0) {
    extra = r2c(extra - desc);
    desc = 0;
  }
  if (desc > 0) {
    let acumulado = 0;
    itens.forEach((x, ix) => {
      const d = ix === itens.length - 1 ? r2c(desc - acumulado) : r2c(desc * (x.valorTotal / base));
      x.valorDesconto = Math.min(d, x.valorTotal);
      acumulado = r2c(acumulado + (x.valorDesconto ?? 0));
    });
  }
  if (extra > 0) itens[0].valorOutro = extra;

  const pagRaw = await db
    .select({
      forma: schema.pagamento.formaPagamento,
      valor: schema.pagamento.valor,
      nsu: schema.pagamento.nsuTransacao,
      bandeira: sql<string | null>`COALESCE(${schema.pagamento.bandeiraEfetiva}, ${schema.pagamento.bandeiraMfe})`,
    })
    .from(schema.pagamento)
    .where(
      and(
        eq(schema.pagamento.filialId, filialId),
        eq(schema.pagamento.codigoPedidoExterno, codigoExterno),
      ),
    )
    .orderBy(schema.pagamento.codigoExterno);

  const pagamentos = pagRaw
    .map((g) => {
      const tPag = tPagDe(g.forma);
      const out: EmitirInput['pagamentos'][number] = { tPag, valor: r2c(num(g.valor)) };
      if (tPag === '03' || tPag === '04') {
        const band = tBandDe(g.bandeira);
        if (band) out.tBand = band;
        const nsu = String(g.nsu ?? '');
        if (nsu && nsu !== '0') out.cAut = nsu.slice(0, 20);
      }
      return out;
    })
    .filter((x) => x.valor > 0);

  // FIADO: fecha sem linha em `pagamento` — a dívida vive na conta corrente.
  // Pra SEFAZ é tPag 05 (Crédito Loja). Mesmo tratamento do vendas-local.
  let temFiado = false;
  const somaPg = r2c(pagamentos.reduce((s, x) => s + x.valor, 0));
  if (somaPg < alvo - 0.009) {
    const [cc] = await db
      .select({ credito: schema.movimentoContaCorrente.credito })
      .from(schema.movimentoContaCorrente)
      .where(
        and(
          eq(schema.movimentoContaCorrente.filialId, filialId),
          eq(schema.movimentoContaCorrente.codigoPedidoExterno, codigoExterno),
          sql`COALESCE(${schema.movimentoContaCorrente.credito}, 0) > 0`,
        ),
      )
      .orderBy(sql`${schema.movimentoContaCorrente.codigoExterno} DESC`)
      .limit(1);
    const vFiado = r2c(num(cc?.credito ?? 0));
    if (vFiado > 0) {
      pagamentos.push({ tPag: '05', valor: Math.min(vFiado, r2c(alvo - somaPg)) });
      temFiado = true;
    }
  }
  if (!pagamentos.length) {
    return { ok: false, erro: 'pedido sem pagamento registrado — receba antes de emitir a nota' };
  }

  const mesa = ped.numero ? `MESA ${ped.numero}` : null;
  return {
    ok: true,
    input: {
      pedidoChave: `fb:${codigoExterno}`,
      mesa,
      itens,
      pagamentos,
    },
    resumo: { mesa, total: alvo, itens: itens.length, fiado: temFiado },
  };
}
