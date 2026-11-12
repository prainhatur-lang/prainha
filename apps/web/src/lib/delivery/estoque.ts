// Estoque real do delivery: lê o saldo do nosso estoque pros itens vinculados
// a um produto do salão — some quando acaba, volta quando o estoque volta.
//
// IMPORTANTE: só uma parte dos produtos tem controle de estoque (bebida
// engarrafada e afins) — prato preparado sem ficha NÃO controla. Então isto só
// esgota automaticamente quem de fato tem saldo controlado; o resto continua
// dependendo do botão "esgotado" do painel.

import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { carregarFichaDeVenda, saldoDeVenda } from '@/lib/estoque-venda';

export interface SaldoVariante {
  /** O estoque decide a venda deste produto. */
  controlado: boolean;
  /** Saldo atual (unidades). Null quando o estoque não decide. */
  saldo: number | null;
}

/**
 * Saldos das variantes informadas, por id de variante.
 *
 * Desde 11/11/2026 a conta é a MESMA do garçom e do QR (`@/lib/estoque-venda`):
 * saldo do nosso estoque (produto.estoque_atual + ficha técnica). Antes lia o
 * espelho do Consumer em produto_variante, que parou de andar quando o Consumer
 * saiu (02/11) — o Caldinho de sururu aparecia com 96.140 no delivery.
 */
export async function saldosDasVariantes(
  filialId: string,
  varianteIds: string[],
): Promise<Map<string, SaldoVariante>> {
  const ids = [...new Set(varianteIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const [rows, ficha] = await Promise.all([
    db
      .select({
        varianteId: schema.produtoVariante.id,
        produtoId: schema.produto.id,
        controla: schema.produto.controlaEstoque,
        saldo: schema.produto.estoqueAtual,
      })
      .from(schema.produtoVariante)
      .innerJoin(schema.produto, eq(schema.produto.id, schema.produtoVariante.produtoId))
      .where(
        and(
          eq(schema.produtoVariante.filialId, filialId),
          inArray(schema.produtoVariante.id, ids),
        ),
      ),
    carregarFichaDeVenda(filialId),
  ]);

  const mapa = new Map<string, SaldoVariante>();
  for (const r of rows) {
    const saldo = saldoDeVenda(r, ficha);
    mapa.set(r.varianteId, { controlado: saldo != null, saldo });
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
 * Esgotado de verdade = marcado à mão no painel OU sem saldo no estoque
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
  // saldo negativo = estoque que ninguém conferiu: não tira da venda por ele
  if ((s.saldo ?? 0) < 0) return false;
  return (s.saldo ?? 0) < qtd;
}
