import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false });
const P='7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';

// existe tabela pedido no mirror?
const t = await sql<any[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('pedido','pedidos')`;
console.log('tabela pedido?', t.map(x=>x.table_name));

if (t.length) {
  const tab = t[0].table_name;
  const ped = await sql<any[]>`
    SELECT codigo_externo, valor_total::numeric(12,2), data_abertura, data_fechamento
    FROM ${sql(tab)} WHERE filial_id=${P} AND codigo_externo IN (154905, 154886)`;
  console.log('\n=== Comandas 154905 e 154886 ===');
  console.log(JSON.stringify(ped, null, 1));
}

// todos os pagamentos das 2 comandas
const pg = await sql<any[]>`
  SELECT codigo_pedido_externo, data_pagamento, valor::numeric(12,2), forma_pagamento, forma_efetiva, nsu_transacao
  FROM pagamento WHERE filial_id=${P} AND codigo_pedido_externo IN (154905, 154886)
  ORDER BY codigo_pedido_externo, data_pagamento`;
console.log('\n=== Pagamentos das comandas ===');
console.log(JSON.stringify(pg, null, 1));

// o débito NSU 80965 casou com a venda Cielo de débito?
const m = await sql<any[]>`
  SELECT va.nsu, va.forma_pagamento, m.nivel_match
  FROM match_pdv_cielo m JOIN venda_adquirente va ON va.id=m.venda_adquirente_id
  JOIN pagamento p ON p.id=m.pagamento_id
  WHERE p.filial_id=${P} AND p.nsu_transacao='80965'`;
console.log('\n=== Débito 80965 casado? ===');
console.log(JSON.stringify(m, null, 1));
await sql.end();
