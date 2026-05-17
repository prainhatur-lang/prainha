// Check rapido: pedido_item.produto_id e codigo_produto_externo estao
// sendo populados? Compara 0001 e 0002.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const sql = postgres(url!, { prepare: false });

async function main() {
  const stats = await sql<Array<{
    filial: string;
    total_pi: number;
    com_produto_id: number;
    com_codigo_externo: number;
    com_nome_produto: number;
  }>>`
    SELECT
      f.nome AS filial,
      count(*)::int AS total_pi,
      count(*) FILTER (WHERE pi.produto_id IS NOT NULL)::int AS com_produto_id,
      count(*) FILTER (WHERE pi.codigo_produto_externo IS NOT NULL)::int AS com_codigo_externo,
      count(*) FILTER (WHERE pi.nome_produto IS NOT NULL)::int AS com_nome_produto
    FROM pedido_item pi
    JOIN filial f ON f.id = pi.filial_id
    GROUP BY f.nome
    ORDER BY f.nome
  `;
  console.log('Estado de pedido_item por filial:');
  console.table(stats);

  const sample = await sql<Array<{
    filial: string;
    codigo_produto_externo: number | null;
    nome_produto: string | null;
    quantidade: number | null;
    sincronizado_em: Date | null;
  }>>`
    SELECT f.nome AS filial, pi.codigo_produto_externo, pi.nome_produto, pi.quantidade, pi.sincronizado_em
    FROM pedido_item pi
    JOIN filial f ON f.id = pi.filial_id
    ORDER BY pi.sincronizado_em DESC NULLS LAST
    LIMIT 10
  `;
  console.log('\n10 pedido_items mais recentes (geral):');
  console.table(sample);

  await sql.end();
}

main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
