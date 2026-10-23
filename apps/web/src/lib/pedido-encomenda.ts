// Pedido sob encomenda (23/10/2026): material feito sob medida (embalagem,
// guardanapo, uniforme...) com entrada antecipada + restante. As parcelas
// ficam em pedido_compra_parcela e cada uma vira uma conta_pagar MANUAL.
//
// Quando a nota fiscal do pedido chega, ela NÃO cria conta nova: as
// duplicatas apontam pras contas que o pedido já criou (ver
// contasDoPedidoPraNota, usado em lancar-estoque e parcelas-manuais).

import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { irmaosDoFornecedor } from '@/lib/fornecedor-unico';

/** Soma N dias úteis (seg–sex) a uma data YYYY-MM-DD. Feriado não conta. */
export function somarDiasUteis(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  let falta = Math.max(0, Math.round(n));
  while (falta > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) falta--;
  }
  return d.toISOString().slice(0, 10);
}

/** Soma N dias corridos a uma data YYYY-MM-DD. */
export function somarDias(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(n));
  return d.toISOString().slice(0, 10);
}

/** Descrição da conta da parcela. Pix: sem "1/2" nem "boleto" — é o que faz
 *  a conta aparecer em /financeiro/pedidos-pix. Boleto: leva "(boleto)" pra
 *  ficar fora da lista de Pix. */
export function descricaoParcela(p: {
  numero: number;
  fornecedorNome: string;
  tipo: 'ENTRADA' | 'RESTANTE';
  forma: 'PIX' | 'BOLETO';
  quando: 'DATA' | 'PRAZO' | 'PRONTO';
  ordemRestante: number;
  totalRestante: number;
}): string {
  const forn = p.fornecedorNome.trim().slice(0, 60);
  const oque =
    p.tipo === 'ENTRADA'
      ? 'entrada'
      : p.totalRestante > 1
        ? `restante (${p.ordemRestante}ª de ${p.totalRestante})`
        : 'restante';
  const pronto = p.quando === 'PRONTO' ? ' — quando ficar pronto' : '';
  const forma = p.forma === 'PIX' ? ' (Pix)' : ' (boleto)';
  return `Pedido #${p.numero} ${forn} — ${oque}${pronto}${forma}`;
}

export interface ParcelaDoPedido {
  parcelaId: string;
  contaPagarId: string;
  ordem: number;
  valor: number;
}

/** Acha o pedido sob encomenda (com parcelas) que é desta nota.
 *  1º pedido já ligado à nota; senão UM único pedido aberto do mesmo
 *  fornecedor (ou irmão do cadastro único / mesma raiz de CNPJ), na mesma casa,
 *  sem nota e com total ±10% — e liga o pedido à nota.
 *  Devolve null quando não há pedido com parcelas (fluxo antigo segue igual). */
export async function contasDoPedidoPraNota(notaCompraId: string): Promise<{
  pedidoId: string;
  numero: number;
  parcelas: ParcelaDoPedido[];
} | null> {
  const [nota] = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      fornecedorId: schema.notaCompra.fornecedorId,
      emitCnpj: schema.notaCompra.emitCnpj,
      valorTotal: schema.notaCompra.valorTotal,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, notaCompraId))
    .limit(1);
  if (!nota) return null;

  const comParcelas = sql`EXISTS (SELECT 1 FROM pedido_compra_parcela pp WHERE pp.pedido_compra_id = ${schema.pedidoCompra.id})`;

  let [ped] = await db
    .select({ id: schema.pedidoCompra.id, numero: schema.pedidoCompra.numero })
    .from(schema.pedidoCompra)
    .where(
      and(
        eq(schema.pedidoCompra.filialId, nota.filialId),
        eq(schema.pedidoCompra.notaCompraId, nota.id),
        comParcelas,
      ),
    )
    .limit(1);

  if (!ped) {
    const ids = new Set<string>();
    if (nota.fornecedorId) {
      ids.add(nota.fornecedorId);
      for (const x of await irmaosDoFornecedor(nota.fornecedorId).catch(() => [] as string[])) ids.add(x);
    }
    const raiz = nota.emitCnpj && nota.emitCnpj.length === 14 ? nota.emitCnpj.slice(0, 8) : null;
    if (ids.size === 0 && !raiz) return null;
    const mesmoFornecedor = raiz
      ? ids.size
        ? sql`(${inArray(schema.pedidoCompra.fornecedorId, [...ids])} OR left(${schema.fornecedor.cnpjOuCpf}, 8) = ${raiz})`
        : sql`left(${schema.fornecedor.cnpjOuCpf}, 8) = ${raiz}`
      : inArray(schema.pedidoCompra.fornecedorId, [...ids]);
    const totalNota = Number(nota.valorTotal ?? 0);
    const candidatos = await db
      .select({
        id: schema.pedidoCompra.id,
        numero: schema.pedidoCompra.numero,
        valorTotal: schema.pedidoCompra.valorTotal,
      })
      .from(schema.pedidoCompra)
      .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.pedidoCompra.fornecedorId))
      .where(
        and(
          eq(schema.pedidoCompra.filialId, nota.filialId),
          isNull(schema.pedidoCompra.notaCompraId),
          ne(schema.pedidoCompra.status, 'CANCELADO'),
          mesmoFornecedor,
          comParcelas,
        ),
      );
    const casam = candidatos.filter((c) => {
      const t = Number(c.valorTotal ?? 0);
      return totalNota > 0 && t > 0 && Math.abs(t - totalNota) <= t * 0.1;
    });
    if (casam.length !== 1) return null;
    ped = { id: casam[0]!.id, numero: casam[0]!.numero };
    await db
      .update(schema.pedidoCompra)
      .set({ notaCompraId: nota.id, atualizadoEm: sql`now()` })
      .where(and(eq(schema.pedidoCompra.id, ped.id), isNull(schema.pedidoCompra.notaCompraId)));
  }

  const parcelas = await db
    .select({
      parcelaId: schema.pedidoCompraParcela.id,
      contaPagarId: schema.pedidoCompraParcela.contaPagarId,
      ordem: schema.pedidoCompraParcela.ordem,
      valor: schema.pedidoCompraParcela.valor,
    })
    .from(schema.pedidoCompraParcela)
    .innerJoin(schema.contaPagar, eq(schema.contaPagar.id, schema.pedidoCompraParcela.contaPagarId))
    .where(and(eq(schema.pedidoCompraParcela.pedidoCompraId, ped.id), isNull(schema.contaPagar.dataDelete)))
    .orderBy(asc(schema.pedidoCompraParcela.ordem));

  return {
    pedidoId: ped.id,
    numero: ped.numero,
    parcelas: parcelas.flatMap((p) =>
      p.contaPagarId ? [{ parcelaId: p.parcelaId, contaPagarId: p.contaPagarId, ordem: p.ordem, valor: Number(p.valor) }] : [],
    ),
  };
}

/** Aponta cada duplicata da nota pra uma conta do pedido: primeiro a de mesmo
 *  valor, depois pela ordem. Duplicata que sobrar (nota com mais parcelas que
 *  o pedido) aponta pra última conta do pedido — nunca cria conta nova. */
export async function ligarDuplicatasAoPedido(
  duplicatas: { id: string; valor: string | number }[],
  parcelas: ParcelaDoPedido[],
): Promise<number> {
  if (parcelas.length === 0) return 0;
  const livres = [...parcelas];
  let ligadas = 0;
  for (const d of duplicatas) {
    const v = Number(d.valor);
    let idx = livres.findIndex((p) => Math.abs(p.valor - v) < 0.01);
    if (idx < 0 && livres.length) idx = 0;
    const alvo = idx >= 0 ? livres.splice(idx, 1)[0]! : parcelas[parcelas.length - 1]!;
    await db
      .update(schema.notaCompraDuplicata)
      .set({ contaPagarId: alvo.contaPagarId })
      .where(eq(schema.notaCompraDuplicata.id, d.id));
    ligadas++;
  }
  return ligadas;
}
