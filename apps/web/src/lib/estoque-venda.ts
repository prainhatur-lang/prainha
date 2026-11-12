// SALDO QUE VALE PRA VENDER — uma regra só pro garçom, pro QR do cliente e pro
// delivery (regra do dono, 11/11/2026: produto autorizado some quando o estoque
// acaba e volta quando o estoque volta).
//
// Devolve `null` quando o estoque não decide nada (produto que não controla, ou
// prato cujo insumo tem saldo) e um número quando decide: <= 0 é esgotado.
//
// Três casos:
//  1. Produto que controla o próprio estoque e tem saldo → o saldo dele.
//  2. Controla, está zerado, mas sai de INSUMO pela ficha técnica: quem tem
//     estoque é o insumo. Só é esgotado se algum insumo também faltar. (Em
//     03/10/2026 o Prato Kids da Mar aparecia esgotado com 20 "File kids".)
//  3. NÃO controla, mas a ficha é uma REVENDA 1:1 (uma linha só, 1 unidade de um
//     insumo que controla estoque — o vinho, o espumante): segue o insumo.
//     Só vale com saldo EXATAMENTE zero e insumo que já teve movimento:
//     saldo negativo é estoque que ninguém conferiu, e insumo sem movimento
//     nunca foi contado — nos dois a venda continua (regra 6: não tirar da
//     venda o que hoje vende por causa de número que não é confiável).
import { and, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '@concilia/db';

export interface FichaDeVenda {
  /** chave `p:<produtoId>` (ficha do produto inteiro) ou `v:<varianteId>` */
  temInsumo: Set<string>;
  faltaInsumo: Set<string>;
  /** quantas linhas de ficha (que baixam estoque) cada chave tem */
  linhas: Map<string, number>;
  /** chave cuja linha é revenda 1:1 → saldo do insumo e se já teve movimento */
  revenda: Map<string, { insumoId: string; insumoNome: string; saldo: number; teveMovimento: boolean }>;
}

export interface LinhaDeVenda {
  controla: boolean | null;
  saldo: string | number | null;
  produtoId: string;
  varianteId: string;
}

export async function carregarFichaDeVenda(filialId: string): Promise<FichaDeVenda> {
  const insumo = alias(schema.produto, 'insumo');
  const ficha = await db
    .select({
      produtoId: schema.fichaTecnica.produtoId,
      varianteId: schema.fichaTecnica.varianteId,
      quantidade: schema.fichaTecnica.quantidade,
      unidade: schema.fichaTecnica.unidade,
      insumoId: insumo.id,
      insumoNome: insumo.nome,
      insumoControla: insumo.controlaEstoque,
      saldo: insumo.estoqueAtual,
    })
    .from(schema.fichaTecnica)
    .innerJoin(insumo, eq(insumo.id, schema.fichaTecnica.insumoId))
    .where(and(eq(schema.fichaTecnica.filialId, filialId), eq(schema.fichaTecnica.baixaEstoque, true)));

  const temInsumo = new Set<string>();
  const faltaInsumo = new Set<string>();
  const linhas = new Map<string, number>();
  const revenda: FichaDeVenda['revenda'] = new Map();
  for (const l of ficha) {
    // linha sem tamanho vale pro produto inteiro; com tamanho, só pra ele
    const chave = l.varianteId ? `v:${l.varianteId}` : `p:${l.produtoId}`;
    linhas.set(chave, (linhas.get(chave) ?? 0) + 1);
    if (l.insumoControla !== true) continue;
    // insumo que nunca teve entrada (saldo null) não diz nada
    if (l.saldo == null) continue;
    const saldo = Number(l.saldo);
    if (saldo > 0) temInsumo.add(chave);
    else faltaInsumo.add(chave);
    const un = (l.unidade ?? '').trim().toLowerCase();
    if (Number(l.quantidade) === 1 && (un === '' || un === 'un')) {
      revenda.set(chave, { insumoId: l.insumoId, insumoNome: l.insumoNome ?? '', saldo, teveMovimento: false });
    }
  }

  // "já teve movimento" só importa pro insumo de revenda que está zerado
  const zerados = [...new Set([...revenda.values()].filter((r) => r.saldo === 0).map((r) => r.insumoId))];
  if (zerados.length > 0) {
    const comMov = await db
      .selectDistinct({ id: schema.movimentoEstoque.produtoId })
      .from(schema.movimentoEstoque)
      .where(inArray(schema.movimentoEstoque.produtoId, zerados));
    const ids = new Set(comMov.map((m) => m.id));
    for (const r of revenda.values()) if (ids.has(r.insumoId)) r.teveMovimento = true;
  }
  return { temInsumo, faltaInsumo, linhas, revenda };
}

/** A revenda 1:1 da variante (caso 3), se a ficha dela for uma linha só. */
export function revendaDaVariante(l: { produtoId: string; varianteId: string }, f: FichaDeVenda) {
  const p = `p:${l.produtoId}`;
  const v = `v:${l.varianteId}`;
  if ((f.linhas.get(p) ?? 0) + (f.linhas.get(v) ?? 0) !== 1) return null;
  return f.revenda.get(v) ?? f.revenda.get(p) ?? null;
}

export function saldoDeVenda(l: LinhaDeVenda, f: FichaDeVenda): number | null {
  if (!l.controla) {
    const r = revendaDaVariante(l, f);
    return r && r.saldo === 0 && r.teveMovimento ? 0 : null;
  }
  const proprio = Number(l.saldo ?? 0);
  if (proprio > 0) return proprio;
  const chaves = [`p:${l.produtoId}`, `v:${l.varianteId}`];
  const tem = chaves.some((c) => f.temInsumo.has(c));
  const falta = chaves.some((c) => f.faltaInsumo.has(c));
  // tem insumo e nenhum zerado → disponível, sem número (o saldo é do insumo)
  if (tem && !falta) return null;
  return proprio;
}
