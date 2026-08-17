// Preenche delivery_complemento a partir dos vínculos que o Consumer já tem
// (produto_variante_complemento) — o que a casa oferece depois do prato.
// Idempotente: refaz a lista do item a cada execução.
//
// PREÇO: acompanhamento junto do prato custa MENOS que avulso, e o espelho do
// Consumer não traz esse valor (o agente sincroniza só o vínculo — ver
// concilia-mappers, PRODUTODETALHECOMPLEMENTO). Então o preço sai do que a
// casa REALMENTE cobrou: a moda de valor_unitario nos itens de pedido que
// entraram como complemento (codigo_pai preenchido), sobre 70 mil vendas.
// Exemplos reais da Prainha Bar: Vinagrete R$5 avulso → R$1 acompanhando
// (1.415 de 1.523 vezes); Molho Rosé R$7 → R$0; Fetuccine R$18 → R$0 ou R$15.
// Sem histórico, cai no preço avulso — e o painel permite corrigir à mão.
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
    Array<{
      item_id: string;
      nome: string;
      preco: string;
      preco_avulso: string;
      vezes: number | null;
      variante_id: string;
    }>
  >`
    WITH cobrado AS (
      -- Valor que a casa mais cobrou por este produto QUANDO ele saiu como
      -- complemento de um prato (codigo_pai preenchido). DISTINCT ON pega a
      -- linha mais frequente de cada produto.
      SELECT DISTINCT ON (pi.produto_id)
             pi.produto_id, pi.valor_unitario AS valor, count(*) AS vezes
      FROM pedido_item pi
      WHERE pi.filial_id = ${FILIAL}
        AND pi.codigo_pai IS NOT NULL
        AND pi.data_delete IS NULL
        AND pi.valor_unitario IS NOT NULL
      GROUP BY pi.produto_id, pi.valor_unitario
      ORDER BY pi.produto_id, count(*) DESC, pi.valor_unitario ASC
    )
    SELECT DISTINCT di.id AS item_id, pf.nome,
           coalesce(cb.valor, pvf.preco_venda, pf.preco_venda, 0)::text AS preco,
           coalesce(pvf.preco_venda, pf.preco_venda, 0)::text AS preco_avulso,
           cb.vezes::int AS vezes,
           pvf.id AS variante_id
    FROM delivery_item di
    JOIN produto_variante_complemento c ON c.variante_id = di.variante_id
    JOIN produto_variante pvf ON pvf.id = c.complemento_id
    JOIN produto pf ON pf.filial_id = pvf.filial_id AND pf.codigo_externo = pvf.codigo_produto_externo
    LEFT JOIN cobrado cb ON cb.produto_id = pf.id
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
    SELECT count(DISTINCT item_id)::int itens, count(*)::int vinculos,
           count(*) FILTER (WHERE preco = 0)::int gratis
    FROM delivery_complemento WHERE filial_id = ${FILIAL}
  `;
  console.log(`${n} complementos gravados · ${r.itens} itens com sugestão · ${r.gratis} grátis`);

  // Onde o preço de acompanhamento difere do avulso — é o ganho desta rotina.
  const dif = new Map<string, { compl: string; avulso: string; vezes: number }>();
  for (const l of linhas) {
    if (Number(l.preco) !== Number(l.preco_avulso)) {
      dif.set(l.nome, { compl: l.preco, avulso: l.preco_avulso, vezes: l.vezes ?? 0 });
    }
  }
  if (dif.size) {
    console.log(`\n${dif.size} complementos com preço diferente do avulso:`);
    for (const [nome, d] of [...dif.entries()].sort((a, b) => b[1].vezes - a[1].vezes).slice(0, 20)) {
      console.log(
        `   ${nome.slice(0, 38).padEnd(38)} avulso R$${Number(d.avulso).toFixed(2).padStart(7)}` +
          ` → acompanhando R$${Number(d.compl).toFixed(2).padStart(7)}  (${d.vezes}x)`,
      );
    }
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error('ERRO:', (e as Error).message);
  await sql.end();
  process.exit(1);
});
