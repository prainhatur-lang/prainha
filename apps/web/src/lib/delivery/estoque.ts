// Estoque real do delivery: lê o saldo do Consumer (espelho produto_variante,
// alimentado pelo agente local) pros itens vinculados a um produto do salão.
//
// IMPORTANTE: no Consumer, só uma minoria dos produtos tem controle de estoque
// (bebida engarrafada e afins) — prato preparado NÃO controla. Então isto só
// esgota automaticamente quem de fato tem saldo controlado; o resto continua
// dependendo do botão "esgotado" do painel.

import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@concilia/db';

export interface SaldoVariante {
  /** O Consumer controla estoque deste produto. */
  controlado: boolean;
  /** Saldo atual (unidades). Null quando não controlado. */
  saldo: number | null;
}

/** Saldos das variantes informadas, por id de variante. */
export async function saldosDasVariantes(
  filialId: string,
  varianteIds: string[],
): Promise<Map<string, SaldoVariante>> {
  const ids = [...new Set(varianteIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      id: schema.produtoVariante.id,
      controlado: schema.produtoVariante.estoqueControlado,
      saldo: schema.produtoVariante.estoqueAtual,
    })
    .from(schema.produtoVariante)
    .where(
      and(
        eq(schema.produtoVariante.filialId, filialId),
        inArray(schema.produtoVariante.id, ids),
      ),
    );

  const mapa = new Map<string, SaldoVariante>();
  for (const r of rows) {
    const controlado = r.controlado === true;
    mapa.set(r.id, {
      controlado,
      saldo: controlado && r.saldo != null ? Number(r.saldo) : null,
    });
  }
  return mapa;
}

/** Item do cardápio na forma mínima pra decidir disponibilidade. */
export interface ItemComEstoque {
  varianteId: string | null;
  checarEstoque: boolean;
  esgotado: boolean;
}

/**
 * Esgotado de verdade = marcado à mão no painel OU sem saldo no Consumer
 * (quando o item está vinculado, a trava está ligada e o produto controla
 * estoque). `qtd` permite exigir saldo suficiente pra quantidade pedida.
 */
export function semDisponibilidade(
  item: ItemComEstoque,
  saldos: Map<string, SaldoVariante>,
  qtd = 1,
): boolean {
  if (item.esgotado) return true;
  if (!item.checarEstoque || !item.varianteId) return false;
  const s = saldos.get(item.varianteId);
  if (!s?.controlado) return false;
  return (s.saldo ?? 0) < qtd;
}
