// CADASTRO ÚNICO DE CLIENTE — passo 1: a ligação.
//
// Hoje a mesma pessoa vive em até três lugares: contato de reserva
// (cliente_contato, chave = telefone), cliente do PDV (cliente, chave = código
// do Consumer) e o espelho na nuvem. Medido em 22/08/2026 na Prainha:
//   20.877 contatos · 32.722 clientes · só 5.241 casam por telefone
// Isso escondeu R$ 15.364,59 de fiado numa ficha que dizia "Sem saldo".
//
// A escolha: `cliente` é o cadastro ÚNICO. O contato de reserva passa a ser
// só "os dados de reserva de um cliente", ligado por cliente_id.
//
// Este script só cria a coluna e o índice. O preenchimento é do
// backfill-cliente-unico, que casa por chaves FORTES (telefone completo, CPF,
// e-mail) — nunca por nome: há 2.186 nomes repetidos no cadastro do PDV.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:cliente-unico

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, max: 1 });

async function main() {
  await sql.unsafe(`ALTER TABLE cliente_contato ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES cliente(id) ON DELETE SET NULL`);
  await sql.unsafe(`ALTER TABLE cliente_contato ADD COLUMN IF NOT EXISTS ligado_por varchar(12)`);
  await sql.unsafe(`ALTER TABLE cliente_contato ADD COLUMN IF NOT EXISTS ligado_em timestamptz`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_contato_cliente ON cliente_contato (cliente_id)`);
  // o caminho inverso também: do cliente pro contato, sem varrer a tabela
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_contato_fone8 ON cliente_contato
    (filial_id, right(regexp_replace(coalesce(telefone,''), '[^0-9]', '', 'g'), 8))`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_cliente_fone8 ON cliente
    (filial_id, right(regexp_replace(coalesce(telefone,''), '[^0-9]', '', 'g'), 8))`);

  const c = await sql<Array<{ n: number; ligados: number }>>`
    SELECT count(*)::int n, count(cliente_id)::int ligados FROM cliente_contato`;
  console.log(`[ok] cliente_contato: ${c[0].n} contatos · ${c[0].ligados} já ligados a um cliente`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
