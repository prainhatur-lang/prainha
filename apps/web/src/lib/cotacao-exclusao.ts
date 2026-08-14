// Exclusão de item POR FORNECEDOR na cotação: o gestor pode "tirar" um item
// da cotação de um fornecedor específico (não quer comprar aquilo dele).
// Item excluído: some do link do fornecedor, resposta dele não disputa o
// vencedor e não entra no pedido.
//
// Armazenado em cotacao_fornecedor.itens_excluidos (jsonb, array de
// cotacao_item_id). A coluna é criada sob demanda por garantirColunaExclusao()
// (DDL idempotente) porque o deploy sai antes da migration oficial rodar —
// TODAS as leituras toleram a coluna não existir ainda (retornam vazio).

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

/** Cria a coluna se não existir. Idempotente e barato (no-op quando já existe). */
export async function garantirColunaExclusao(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE cotacao_fornecedor ADD COLUMN IF NOT EXISTS itens_excluidos jsonb NOT NULL DEFAULT '[]'::jsonb`,
  );
}

/** Map cotacao_fornecedor_id -> Set de cotacao_item_id excluídos.
 *  Vazio se a coluna ainda não existe (nenhuma exclusão foi feita). */
export async function lerExclusoesPorCotacao(
  cotacaoId: string,
): Promise<Map<string, Set<string>>> {
  const mapa = new Map<string, Set<string>>();
  try {
    const rows = (await db.execute(
      sql`SELECT id, itens_excluidos FROM cotacao_fornecedor WHERE cotacao_id = ${cotacaoId} AND itens_excluidos <> '[]'::jsonb`,
    )) as unknown as Array<{ id: string; itens_excluidos: unknown }>;
    for (const r of rows) {
      const lista = Array.isArray(r.itens_excluidos) ? (r.itens_excluidos as string[]) : [];
      if (lista.length > 0) mapa.set(r.id, new Set(lista));
    }
  } catch {
    // coluna ainda não existe — sem exclusões
  }
  return mapa;
}

/** Exclui (ou restaura) um item da cotação de UM fornecedor. */
export async function definirExclusaoItem(
  cotacaoFornecedorId: string,
  cotacaoItemId: string,
  excluir: boolean,
): Promise<void> {
  await garantirColunaExclusao();
  if (excluir) {
    await db.execute(
      sql`UPDATE cotacao_fornecedor
          SET itens_excluidos = CASE
            WHEN itens_excluidos @> jsonb_build_array(${cotacaoItemId}::text) THEN itens_excluidos
            ELSE itens_excluidos || jsonb_build_array(${cotacaoItemId}::text)
          END
          WHERE id = ${cotacaoFornecedorId}`,
    );
  } else {
    await db.execute(
      sql`UPDATE cotacao_fornecedor
          SET itens_excluidos = itens_excluidos - ${cotacaoItemId}
          WHERE id = ${cotacaoFornecedorId}`,
    );
  }
}
