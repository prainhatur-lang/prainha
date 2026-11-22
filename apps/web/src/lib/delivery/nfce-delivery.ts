// NFC-e do pedido do DELIVERY do site — dono 22/11/2026 ("na hora que ele for
// despachar, tem que emitir a nota"). O pedido pago online (Pix/cartão no
// site) nunca vira pedido do PDV, então não aparece em "Pedidos sem nota" e
// ninguém emitia. Aqui a nota sai direto do delivery_pedido:
//  · chave de idempotência `delivery:<id>` (emitir de novo devolve a mesma);
//  · CPF do cliente (se ele informou no site) vai na nota;
//  · itens pelo total de cada um (complementos já somados), desconto rateado,
//    taxa de entrega como vOutro no 1º item — fecha exato no total pago;
//  · Pix → tPag 17, cartão → 03;
//  · depois de autorizada, entra na fila de impressão da loja (o caixa da casa
//    imprime o DANFE na impressora de sempre).
// Pedido "pagar na entrega" NÃO passa aqui: esse vira pedido no PDV quando o
// caixa aceita e a nota sai por lá (Pedidos sem nota), como sempre.

import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { emitirNfcePedido, type EmitirInput } from '@/lib/nfce/emitir';

const r2c = (v: number): number => Math.round(v * 100) / 100;
const num = (v: string | number | null | undefined): number => (v == null ? 0 : Number(v));

export type ResultadoNfceDelivery =
  | { ok: true; nfceId: string; numero: number; jaExistia: boolean; naFila: boolean }
  | { ok: false; erro: string; pular?: boolean };

/** Emite (ou devolve a já emitida) a NFC-e do pedido do delivery e manda o
 *  DANFE pra impressora da loja. Nunca lança. */
export async function emitirNfceDelivery(
  pedidoId: string,
  solicitadoPor: string | null,
  opts: { imprimir?: boolean } = {},
): Promise<ResultadoNfceDelivery> {
  try {
    const [p] = await db
      .select()
      .from(schema.deliveryPedido)
      .where(eq(schema.deliveryPedido.id, pedidoId))
      .limit(1);
    if (!p) return { ok: false, erro: 'pedido não encontrado' };
    if (p.status === 'cancelado') return { ok: false, erro: 'pedido cancelado', pular: true };
    // Na entrega vira pedido no PDV quando o caixa aceita: a nota sai por lá.
    // Mesmo depois de 'pago_entrega' não emite aqui — seria nota em dobro.
    if (p.pagamentoMetodo === 'na_entrega' || p.pagamentoStatus === 'na_entrega') {
      return {
        ok: false,
        pular: true,
        erro: 'pagamento na entrega: a nota sai pelo caixa da loja (Pedidos sem nota)',
      };
    }
    if (p.pagamentoStatus !== 'pago') return { ok: false, pular: true, erro: 'pedido ainda não pago' };

    const itensRaw = await db
      .select({
        nome: schema.deliveryPedidoItem.nome,
        qtd: schema.deliveryPedidoItem.qtd,
        total: schema.deliveryPedidoItem.total,
        codigo: schema.produtoVariante.codigoProdutoExterno,
        ncm: schema.produto.ncm,
        cfop: schema.produto.cfop,
      })
      .from(schema.deliveryPedidoItem)
      .leftJoin(schema.deliveryItem, eq(schema.deliveryItem.id, schema.deliveryPedidoItem.itemId))
      .leftJoin(
        schema.produtoVariante,
        and(
          eq(schema.produtoVariante.id, schema.deliveryItem.varianteId),
          eq(schema.produtoVariante.filialId, p.filialId),
        ),
      )
      .leftJoin(schema.produto, eq(schema.produto.id, schema.produtoVariante.produtoId))
      .where(eq(schema.deliveryPedidoItem.pedidoId, p.id));

    const itens = itensRaw
      .map((r) => ({
        codigo: r.codigo != null ? String(r.codigo) : 'DLV',
        descricao: (r.nome ?? '').trim() || 'ITEM',
        quantidade: num(r.qtd),
        valorTotal: r2c(num(r.total)),
        ncm: r.ncm ?? undefined,
        cfop: r.cfop ?? undefined,
      }))
      .filter((x) => x.quantidade > 0 && x.valorTotal > 0) as Array<
      EmitirInput['itens'][number] & { valorDesconto?: number; valorOutro?: number }
    >;
    if (!itens.length) return { ok: false, erro: 'pedido sem itens com valor' };

    const alvo = r2c(num(p.total));
    if (!(alvo > 0)) return { ok: false, erro: 'pedido sem valor' };

    // Recalibra pra fechar exato no total pago: o que sobra vira desconto
    // rateado; o que falta (taxa de entrega) vira vOutro no 1º item.
    const base = r2c(itens.reduce((s, x) => s + x.valorTotal, 0));
    let extra = r2c(num(p.taxaEntrega));
    let desc = r2c(base + extra - alvo);
    if (desc < 0) {
      extra = r2c(extra - desc);
      desc = 0;
    }
    if (desc > 0) {
      let acumulado = 0;
      itens.forEach((x, ix) => {
        const d =
          ix === itens.length - 1 ? r2c(desc - acumulado) : r2c(desc * (x.valorTotal / base));
        x.valorDesconto = Math.min(Math.max(d, 0), x.valorTotal);
        acumulado = r2c(acumulado + (x.valorDesconto ?? 0));
      });
    }
    if (extra > 0) itens[0].valorOutro = extra;

    const tPag = p.pagamentoMetodo === 'cartao' ? '03' : '17';
    const cpf = String(p.clienteCpf ?? '').replace(/\D/g, '');

    const r = await emitirNfcePedido(p.filialId, {
      pedidoChave: `delivery:${p.id}`,
      mesa: `DELIVERY #${p.numero}`,
      documento: cpf.length === 11 || cpf.length === 14 ? cpf : null,
      itens,
      pagamentos: [{ tPag, valor: alvo }],
      infoExtra: `Pedido delivery #${p.numero}`,
      solicitadoPor: solicitadoPor?.slice(0, 60) ?? 'delivery',
    });
    if (!r.ok) return { ok: false, erro: r.erro };

    let naFila = false;
    if (opts.imprimir !== false && r.nota.status === 'AUTORIZADA') {
      const [pendente] = await db
        .select({ id: schema.nfceReimpressao.id })
        .from(schema.nfceReimpressao)
        .where(
          and(
            eq(schema.nfceReimpressao.nfceId, r.nota.id),
            eq(schema.nfceReimpressao.status, 'PENDENTE'),
          ),
        )
        .limit(1);
      // Na primeira emissão manda sempre; se já existia, só a pedido (imprimir: true).
      if (!pendente && (!r.jaExistia || opts.imprimir === true)) {
        await db.insert(schema.nfceReimpressao).values({
          filialId: p.filialId,
          nfceId: r.nota.id,
          solicitadoPor: solicitadoPor?.slice(0, 60) ?? 'delivery',
        });
      }
      naFila = true;
    }
    return { ok: true, nfceId: r.nota.id, numero: r.nota.numero, jaExistia: r.jaExistia, naFila };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

export interface SituacaoNotaDelivery {
  /** 'autorizada' | 'emitindo' | 'falhou' | 'sem_nota' | 'nao_se_aplica' */
  situacao: 'autorizada' | 'emitindo' | 'falhou' | 'sem_nota' | 'nao_se_aplica';
  nfceId?: string;
  numero?: number;
  motivo?: string | null;
}

/** Situação da NFC-e do pedido do delivery, pro card do painel mostrar se a
 *  nota saiu no despacho (dono 22/11/2026: "toda vez que mandar o delivery já
 *  mandar com a nota fiscal"). */
export async function situacaoNotaDelivery(pedidoId: string): Promise<SituacaoNotaDelivery> {
  const [p] = await db
    .select({
      filialId: schema.deliveryPedido.filialId,
      status: schema.deliveryPedido.status,
      pagamentoMetodo: schema.deliveryPedido.pagamentoMetodo,
      pagamentoStatus: schema.deliveryPedido.pagamentoStatus,
    })
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.id, pedidoId))
    .limit(1);
  if (!p) return { situacao: 'nao_se_aplica' };
  const notas = await db
    .select({
      id: schema.nfceEmitida.id,
      numero: schema.nfceEmitida.numero,
      status: schema.nfceEmitida.status,
      xmotivo: schema.nfceEmitida.xmotivo,
    })
    .from(schema.nfceEmitida)
    .where(
      and(
        eq(schema.nfceEmitida.filialId, p.filialId),
        eq(schema.nfceEmitida.pedidoChave, `delivery:${pedidoId}`),
      ),
    )
    .orderBy(desc(schema.nfceEmitida.atualizadoEm));
  const aut = notas.find((n) => n.status === 'AUTORIZADA');
  if (aut) return { situacao: 'autorizada', nfceId: aut.id, numero: aut.numero };
  if (
    p.status === 'cancelado' ||
    p.pagamentoMetodo === 'na_entrega' ||
    p.pagamentoStatus === 'na_entrega' ||
    p.pagamentoStatus !== 'pago'
  ) {
    return { situacao: 'nao_se_aplica' };
  }
  const pend = notas.find((n) => n.status === 'PENDENTE');
  if (pend) return { situacao: 'emitindo', nfceId: pend.id, numero: pend.numero };
  const falha = notas[0];
  if (falha) return { situacao: 'falhou', nfceId: falha.id, numero: falha.numero, motivo: falha.xmotivo };
  return { situacao: 'sem_nota' };
}

/** Rede de segurança: pedido do delivery que já SAIU (saiu_entrega, chegou ou
 *  concluído), pago online e sem NFC-e autorizada → tenta emitir de novo. O
 *  painel chama no polling; a mesma chave `delivery:<id>` impede nota em dobro
 *  e uma tentativa que falhou só se repete depois de 5 min. Nunca lança. */
export async function reemitirNotasDeliveryFaltando(filialIds: string[]): Promise<number> {
  if (filialIds.length === 0) return 0;
  try {
    const desde = new Date(Date.now() - 2 * 86_400_000);
    const candidatos = await db
      .select({ id: schema.deliveryPedido.id, status: schema.deliveryPedido.status })
      .from(schema.deliveryPedido)
      .where(
        and(
          inArray(schema.deliveryPedido.filialId, filialIds),
          inArray(schema.deliveryPedido.status, ['saiu_entrega', 'chegou', 'concluido']),
          eq(schema.deliveryPedido.pagamentoStatus, 'pago'),
          sql`coalesce(${schema.deliveryPedido.pagamentoMetodo}, '') <> 'na_entrega'`,
          gte(schema.deliveryPedido.criadoEm, desde),
          sql`not exists (
            select 1 from nfce_emitida n
             where n.filial_id = ${schema.deliveryPedido.filialId}
               and n.pedido_chave = 'delivery:' || ${schema.deliveryPedido.id}::text
               and (n.status in ('AUTORIZADA', 'PENDENTE')
                    or n.atualizado_em > now() - interval '5 minutes')
          )`,
        ),
      )
      .limit(5);
    let feitas = 0;
    for (const c of candidatos) {
      // Ainda na rua: o DANFE vai pra impressora da loja. Já concluído: só emite.
      const r = await emitirNfceDelivery(c.id, 'delivery (reemissão)', {
        imprimir: c.status === 'concluido' ? false : undefined,
      });
      if (r.ok) feitas++;
      else console.error('[delivery] reemissão da NFC-e falhou', c.id, r.erro);
    }
    return feitas;
  } catch (e) {
    console.error('[delivery] reemissão de notas', e);
    return 0;
  }
}
