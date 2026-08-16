// Preenche delivery_complemento a partir dos vínculos que o Consumer já tem
// (produto_variante_complemento) — o que a casa oferece depois do prato.
// Idempotente: refaz a lista do item a cada execução.
//
// Uso: pnpm --filter @concilia/db sync:complementos [-- --filial <uuid>]

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const args = process.argv.slice(2);
const arg = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const FILIAL = arg('filial', '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9')!;

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  const linhas = await sql<
    Array<{ item_id: string; nome: string; preco: string; variante_id: string }>
  >`
    SELECT DISTINCT di.id AS item_id, pf.nome,
           coalesce(pvf.preco_venda, pf.preco_venda, 0)::text AS preco,
           pvf.id AS variante_id
    FROM delivery_item di
    JOIN produto_variante_complemento c ON c.variante_id = di.variante_id
    JOIN produto_variante pvf ON pvf.id = c.complemento_id
    JOIN produto pf ON pf.filial_id = pvf.filial_id AND pf.codigo_externo = pvf.codigo_produto_externo
    WHERE di.filial_id = ${FILIAL}
      AND pvf.data_delete IS NULL AND pvf.data_pausado IS NULL
      AND (pf.descontinuado = false OR pf.descontinuado IS NULL)
    ORDER BY di.id, pf.nome
  `;

  await sql`DELETE FROM delivery_complemento WHERE filial_id = ${FILIAL}`;

  let n = 0;
  const porItem = new Map<string, number>();
  for (const l of linhas) {
    const nome = String(l.nome ?? '').trim();
    if (!nome) continue;
    const ordem = (porItem.get(l.item_id) ?? 0) + 1;
    porItem.set(l.item_id, ordem);
    await sql`
      INSERT INTO delivery_complemento (filial_id, item_id, nome, preco, variante_id, ordem)
      VALUES (${FILIAL}, ${l.item_id}, ${nome.slice(0, 160)}, ${Number(l.preco).toFixed(2)}, ${l.variante_id}, ${ordem})
    `;
    n++;
  }

  const [r] = await sql`
    SELECT count(DISTINCT item_id)::int itens, count(*)::int vinculos
    FROM delivery_complemento WHERE filial_id = ${FILIAL}
  `;
  console.log(`${n} complementos gravados · ${r.itens} itens do cardápio com sugestão`);
  await sql.end();
}

main().catch(async (e) => {
  console.error('ERRO:', (e as Error).message);
  await sql.end();
  process.exit(1);
});
