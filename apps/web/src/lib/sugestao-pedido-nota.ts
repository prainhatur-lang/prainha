// Insumo do pedido de compra sugerido pra cada item da nota sem vínculo.
//
// Pedido do dono (15/10/2026): "não conseguimos já linkar os produtos pedidos
// no pedido de compra à nota de entrada". O confronto (lib/confronto-pedido-nota)
// já casa item da nota × item do pedido — pelo insumo ou pelo valor no centavo.
// Aqui isso vira sugestão de vínculo:
//  - linha do confronto com UM item desta nota sem insumo → o insumo do pedido;
//  - sobrou item da nota sem par e item do pedido que "não veio" → casa pelas
//    palavras do nome (DETERGENTE 500ML × DETERGENTE, PAPEL TOALHA INTERFOLHADO
//    × PAPEL TOALHA INTERFOLHA), um pra um.
// `fatorSeguro` só existe quando dá pra vincular sem perguntar: valor bateu,
// só esta nota faturou o item e o pedido está na unidade de estoque do insumo —
// aí a conversão é a própria razão das quantidades (20 kg pedidos × 20 UN na
// nota = fator 1). O resto vai pelo modal, que confere a conversão.

import type { ConfrontoNota } from '@/lib/confronto-pedido-nota';

export interface SugestaoPedido {
  produtoId: string;
  produtoNome: string;
  pedidoNumero: number;
  como: 'pedido' | 'nome';
  fatorSeguro: number | null;
}

const GENERICAS = new Set([
  'COM', 'SEM', 'PARA', 'TIPO', 'UND', 'UNID', 'PCT', 'PACOTE', 'CAIXA', 'FARDO', 'INTEGRAL',
  'DE', 'DA', 'DO', 'DOS', 'DAS', 'NATURA',
]);

function palavras(nome: string): Set<string> {
  return new Set(
    nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .split(' ')
      .filter((t) => t.length >= 3 && !/\d/.test(t) && !GENERICAS.has(t)),
  );
}

/** Palavras em comum; prefixo de 6+ letras conta (INTERFOLHADO × INTERFOLHA). */
function pontos(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) {
    for (const y of b) {
      if (x === y || (x.length >= 6 && y.length >= 6 && (x.startsWith(y) || y.startsWith(x)))) {
        n++;
        break;
      }
    }
  }
  return n;
}

export function sugestoesDoPedido(
  c: ConfrontoNota,
  itens: { id: string; produtoId: string | null; descricao: string | null; quantidade: string | null }[],
): Map<string, SugestaoPedido> {
  const out = new Map<string, SugestaoPedido>();
  const porId = new Map(itens.map((i) => [i.id, i]));

  for (const l of c.linhas) {
    if (l.notaItemIds.length !== 1) continue;
    const it = porId.get(l.notaItemIds[0]);
    if (!it || it.produtoId) continue;
    const qNota = Number(it.quantidade ?? 0);
    const seguro =
      l.situacao === 'OK' &&
      l.outrasNotas.length === 0 &&
      qNota > 0 &&
      l.pedQtd > 0 &&
      (l.produtoUnidade ?? '').toLowerCase() === (l.pedUnidade ?? '').toLowerCase();
    out.set(it.id, {
      produtoId: l.produtoId,
      produtoNome: l.produtoNome,
      pedidoNumero: l.pedidoNumero,
      como: 'pedido',
      fatorSeguro: seguro ? Math.round((l.pedQtd / qNota) * 1e6) / 1e6 : null,
    });
  }

  // Pelo nome: cada item do pedido serve a um item da nota só.
  const soltos = c.semVinculo.filter((s) => s.notaItemId && !out.has(s.notaItemId));
  const pares: { notaItemId: string; idx: number; pts: number }[] = [];
  c.naoVieram.forEach((nv, idx) => {
    const pp = palavras(nv.produtoNome);
    for (const s of soltos) {
      const pts = pontos(palavras(s.descricao), pp);
      if (pts > 0) pares.push({ notaItemId: s.notaItemId!, idx, pts });
    }
  });
  pares.sort((a, b) => b.pts - a.pts);
  const usado = new Set<number>();
  for (const p of pares) {
    if (usado.has(p.idx) || out.has(p.notaItemId)) continue;
    usado.add(p.idx);
    const nv = c.naoVieram[p.idx];
    out.set(p.notaItemId, {
      produtoId: nv.produtoId,
      produtoNome: nv.produtoNome,
      pedidoNumero: nv.pedidoNumero,
      como: 'nome',
      fatorSeguro: null,
    });
  }
  return out;
}
