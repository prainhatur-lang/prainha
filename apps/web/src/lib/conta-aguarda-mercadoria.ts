// Conta que só se paga depois que a mercadoria chegar, ou com autorização.
// Dono 26/11/2026 (pedido 17351 da Kompack, pago metade agora e metade depois):
// "A diferença só pode ser paga depois que chegar a mercadoria ou que já for
// autorizado. Ela não pode ficar em aberto lá, senão a pessoa pode pagar sem
// receber."
//
// conta_pagar.so_apos_chegar = true → a conta fica TRAVADA (sem Pix, sem baixa)
// até uma das duas:
//   - a mercadoria da nota chegar: conferência ("✓ Chegou") ou todos os itens
//     lançados no estoque — o mesmo critério de /compras/antecipados;
//   - um Admin autorizar (liberada_em/por/motivo).
// Só contas marcadas travam; todas as outras seguem como sempre.

import { db } from '@concilia/db';
import { sql, type SQL } from 'drizzle-orm';

/** SQL (boolean): a mercadoria da nota desta conta já chegou? `c` = alias de conta_pagar. */
export function sqlMercadoriaChegou(c: SQL): SQL {
  return sql`coalesce((
    SELECT n.conferida_em IS NOT NULL
        OR ((SELECT count(*) FROM nota_compra_item i WHERE i.nota_compra_id = n.id) > 0
            AND (SELECT count(DISTINCT m.nota_compra_item_id) FROM movimento_estoque m
                   JOIN nota_compra_item i ON i.id = m.nota_compra_item_id
                  WHERE i.nota_compra_id = n.id)
                >= (SELECT count(*) FROM nota_compra_item i WHERE i.nota_compra_id = n.id))
      FROM nota_compra n WHERE n.id = ${c}.nota_compra_id), false)`;
}

/** SQL (boolean): conta travada esperando a mercadoria (marcada, não autorizada, não chegou). */
export function sqlAguardaMercadoria(c: SQL): SQL {
  return sql`(${c}.so_apos_chegar AND ${c}.liberada_em IS NULL AND NOT ${sqlMercadoriaChegou(c)})`;
}

/** Alguma destas contas ainda espera a mercadoria? Devolve a mensagem da trava, ou null. */
export async function travaAguardaMercadoria(contaIds: string[]): Promise<{ msg: string } | null> {
  const ids = contaIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return null;
  const c = sql`c`;
  const rows = (await db.execute(sql`
    SELECT c.descricao FROM conta_pagar c
     WHERE c.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
       AND ${sqlAguardaMercadoria(c)}
     LIMIT 1
  `)) as unknown as Array<{ descricao: string | null }>;
  if (!rows.length) return null;
  const qual = rows[0]!.descricao ? `"${rows[0]!.descricao}"` : 'Esta conta';
  return {
    msg: `${qual} só se paga depois que a mercadoria chegar. Marque a chegada do pedido (conferência / lançar no estoque) ou peça a autorização do Admin.`,
  };
}
