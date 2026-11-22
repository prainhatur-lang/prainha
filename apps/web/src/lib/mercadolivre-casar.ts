// Casa as compras do Mercado Livre (montadas pelos e-mails) com o dinheiro que
// saiu: Pix no extrato do banco ou lançamento na fatura do cartão.
//
// O que os dados reais mostram (22/11/2026):
// - Pix: o e-mail traz o valor; no extrato do Inter sai "PIX ENVIADO - Cp
//   :10573521-PIX Marketplace" (10573521 = Mercado Pago) com o mesmo valor, no
//   mesmo dia. Casa por valor exato + data (-1..+3 dias).
// - Cartão: o e-mail NÃO traz o valor. A fatura traz "MERCADOLIVRE*XXXXX", onde
//   XXXXX são as 5 primeiras letras do vendedor (às vezes só "MERCA", genérico).
//   Casa por data (-1..+2 dias) + começo do nome do vendedor.
// Só leitura: nada é gravado; a tela recalcula a cada abertura.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export interface PedidoParaCasar {
  pedido: string;
  data: string; // YYYY-MM-DD (BRT) da compra
  total: number | null;
  pix: boolean;
  vendedor: string | null;
}

export interface Casamento {
  como: 'pix' | 'cartao';
  certeza: 'certo' | 'provavel';
  data: string;
  valor: number;
  descricao: string;
  origem: string; // "Banco Inter · Prainha Bar" / "Itaú final 8807 · 1/3"
  id: string;
}

export interface ResultadoCasar {
  porPedido: Map<string, Casamento>;
  /** Pix de marketplace saídos desde a 1ª compra que não casaram com pedido nenhum. */
  pixSobrando: Casamento[];
  /** Última data de compra lida em fatura de cartão (o que vier depois ainda não tem fatura). */
  faturaAte: string | null;
}

interface LinhaPix {
  id: string;
  data: string;
  valor: string;
  descricao: string | null;
  banco: string | null;
  casa: string | null;
}

interface LinhaCartao {
  id: string;
  data: string;
  valor: string;
  estabelecimento: string;
  cartao_final: string | null;
  banco: string | null;
  parcela: number | null;
  total_parcelas: number | null;
}

function dias(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** "61.334.262 LEANDRO P. DA COSTA" → "LEANDROPDACOSTA"; "3A COMERCIO" → "3ACOMERCIO". */
export function nomeCurto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^[\d.\-/ ]{8,}/, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Pedaço do vendedor que a fatura mostra depois do "MERCADOLIVRE*" (vazio = genérico). */
function sufixoFatura(estab: string): string {
  const s = nomeCurto(estab.split('*').slice(1).join(''));
  return /^MERCA/.test(s) ? '' : s;
}

export async function casarComprasML(pedidos: PedidoParaCasar[]): Promise<ResultadoCasar> {
  const porPedido = new Map<string, Casamento>();
  if (!pedidos.length) return { porPedido, pixSobrando: [], faturaAte: null };
  const desde = pedidos.map((p) => p.data).sort()[0]!;

  const pix = (await db.execute(sql`
    SELECT l.id::text, l.data_movimento::text AS data, l.valor::text, l.descricao,
           c.banco, f.nome AS casa
      FROM lancamento_banco l
      LEFT JOIN conta_bancaria c ON c.id = l.conta_bancaria_id
      LEFT JOIN filial f ON f.id = l.filial_id
     WHERE l.tipo = 'D'
       AND l.data_movimento >= (${desde}::date - 1)
       AND (l.descricao ILIKE '%marketplace%' OR l.descricao ILIKE '%mercado pago%' OR l.descricao ILIKE '%mercadopago%')
       AND l.descricao ILIKE '%pix%'
     ORDER BY l.data_movimento
  `)) as unknown as LinhaPix[];

  const cartao = (await db.execute(sql`
    SELECT l.id::text, l.data_compra::text AS data, l.valor::text, l.estabelecimento,
           l.cartao_final, fa.banco, l.parcela, l.total_parcelas
      FROM cartao_lancamento l
      JOIN cartao_fatura fa ON fa.id = l.fatura_id AND fa.excluido_em IS NULL
     WHERE l.data_compra >= (${desde}::date - 1)
       AND (l.estabelecimento ILIKE 'MERCADOLIVRE%' OR l.estabelecimento ILIKE 'MERCADO LIVRE%'
            OR l.estabelecimento ILIKE '%*MERCADOLIVRE%')
       AND coalesce(l.parcela, 1) <= 1
     ORDER BY l.data_compra
  `)) as unknown as LinhaCartao[];

  const faturaAte = ((await db.execute(sql`
    SELECT max(l.data_compra)::text AS ate
      FROM cartao_lancamento l
      JOIN cartao_fatura fa ON fa.id = l.fatura_id AND fa.excluido_em IS NULL
  `)) as unknown as { ate: string | null }[])[0]?.ate ?? null;

  const usados = new Set<string>();

  // 1) Pix: valor exato, data mais próxima
  for (const p of pedidos) {
    if (!p.pix || p.total == null) continue;
    const cands = pix
      .filter((l) => !usados.has(l.id) && Math.abs(Number(l.valor) - p.total!) < 0.005)
      .map((l) => ({ l, d: dias(p.data, l.data) }))
      .filter((x) => x.d >= -1 && x.d <= 3)
      .sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
    const c = cands[0];
    if (!c) continue;
    usados.add(c.l.id);
    porPedido.set(p.pedido, {
      como: 'pix',
      certeza: 'certo',
      data: c.l.data,
      valor: Number(c.l.valor),
      descricao: c.l.descricao ?? 'Pix',
      origem: [c.l.banco, c.l.casa].filter(Boolean).join(' · '),
      id: c.l.id,
    });
  }

  // 2) Cartão: data + começo do nome do vendedor; sem nome, só se for o único do dia
  for (const p of pedidos) {
    if (p.pix || porPedido.has(p.pedido)) continue;
    const vend = nomeCurto(p.vendedor ?? '');
    const cands = cartao
      .filter((l) => !usados.has(l.id))
      .map((l) => ({ l, d: dias(p.data, l.data), suf: sufixoFatura(l.estabelecimento) }))
      .filter((x) => x.d >= -1 && x.d <= 2);
    const peloNome = cands
      .filter((x) => x.suf && vend && (vend.startsWith(x.suf) || x.suf.startsWith(vend.slice(0, 5))))
      .sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
    const genericos = cands.filter((x) => !x.suf);
    const c = peloNome[0] ?? (genericos.length === 1 ? genericos[0] : undefined);
    if (!c) continue;
    usados.add(c.l.id);
    const parc = c.l.total_parcelas && c.l.total_parcelas > 1 ? ` · ${c.l.parcela ?? 1}/${c.l.total_parcelas}` : '';
    porPedido.set(p.pedido, {
      como: 'cartao',
      certeza: peloNome[0] && peloNome.length === 1 ? 'certo' : 'provavel',
      data: c.l.data,
      valor: Number(c.l.valor) * (c.l.total_parcelas && c.l.total_parcelas > 1 ? c.l.total_parcelas : 1),
      descricao: c.l.estabelecimento,
      origem: `${c.l.banco ?? 'Cartão'} final ${c.l.cartao_final ?? '?'}${parc}`,
      id: c.l.id,
    });
  }

  const pixSobrando: Casamento[] = pix
    .filter((l) => !usados.has(l.id) && l.data >= desde)
    .map((l) => ({
      como: 'pix' as const,
      certeza: 'certo' as const,
      data: l.data,
      valor: Number(l.valor),
      descricao: l.descricao ?? 'Pix',
      origem: [l.banco, l.casa].filter(Boolean).join(' · '),
      id: l.id,
    }));

  return { porPedido, pixSobrando, faturaAte };
}
