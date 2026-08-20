// CONDIÇÃO E FORMA DE PAGAMENTO no lançamento de fiado.
//
// Pedido do dono: "deve ter a condição e forma de pagamento no lançamento".
// - forma: como o dinheiro entrou (código do Consumer, FORMASPAGAMENTO —
//   espelhado em forma_pagamento_consumer: 1 Dinheiro, 3 Crédito, 4 Débito,
//   17 Depósito, 18 Pix Manual, 19 Transferência, 2 Cheque).
// - condição: à vista ou a prazo; a prazo guarda o vencimento combinado.
//
// A CONTACORRENTE do Firebird não tem coluna de forma — ela aponta pra
// PAGAMENTOS (CODIGOPAGAMENTO). É exatamente o que o próprio Consumer faz:
// 3.955 pagamentos sem CODIGOPEDIDO no banco real são pagamentos de conta
// corrente. Então a loja cria o PAGAMENTOS com a forma e amarra no movimento.
// Vencimento não existe no Firebird → vai também no texto da observação.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fiado-forma

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE fiado_lancamento ADD COLUMN IF NOT EXISTS forma_codigo integer`);
  await sql.unsafe(`ALTER TABLE fiado_lancamento ADD COLUMN IF NOT EXISTS forma_nome varchar(60)`);
  await sql.unsafe(`ALTER TABLE fiado_lancamento ADD COLUMN IF NOT EXISTS condicao varchar(10)`);
  await sql.unsafe(`ALTER TABLE fiado_lancamento ADD COLUMN IF NOT EXISTS vencimento date`);
  await sql.unsafe(`ALTER TABLE fiado_lancamento ADD COLUMN IF NOT EXISTS pagamento_codigo integer`);
  const cols = await sql<Array<{ c: string }>>`
    SELECT column_name c FROM information_schema.columns
    WHERE table_name='fiado_lancamento' AND column_name IN
      ('forma_codigo','forma_nome','condicao','vencimento','pagamento_codigo') ORDER BY 1`;
  const rls = await sql<Array<{ r: boolean }>>`
    SELECT c.relrowsecurity r FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='fiado_lancamento'`;
  console.log(`[ok] fiado_lancamento: ${cols.map((x) => x.c).join(', ')} · RLS: ${rls[0]?.r ? 'ligado' : 'DESLIGADO ⚠️'}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
