// FILA DE ALTERAÇÃO DE PRODUTO (nuvem → loja).
//
// O Consumer é o dono do cadastro de produto — o Concilia lê pelo espelho
// (CDC) mas não alcança o Firebird da loja. Então alterar preço/categoria/
// pausa pela tela vira uma linha aqui, o vendas-local aplica lá dentro e
// reporta. Mesma mecânica de fiado_lancamento, que já roda em produção.
//
// UMA LINHA POR CAMPO: erro em um campo não derruba os outros, e o histórico
// fica legível ("preço 15,00 → 18,00 por fulano").
//
// Onde cada campo mora no Firebird (conferido no banco real):
//   PRODUTOS       nome, descrição, custo, estoque mín, controla estoque,
//                  categoria (CODIGOETIQUETA), praça (CODIGOCOZINHA),
//                  descontinuado, modo de preparo
//   PRODUTODETALHE preço de VENDA, pausado (DATAPAUSADO), comanda mobile,
//                  cardápio digital  ← é por TAMANHO, não por produto
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:produto-fila

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS produto_alteracao (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      produto_id uuid REFERENCES produto(id) ON DELETE SET NULL,
      produto_codigo_externo integer NOT NULL,
      variante_codigo_externo integer,
      produto_nome varchar(200),
      campo varchar(40) NOT NULL,
      valor text,
      valor_antes text,
      status varchar(10) NOT NULL DEFAULT 'pendente',
      erro text,
      criado_por varchar(120),
      criado_em timestamptz NOT NULL DEFAULT now(),
      aplicado_em timestamptz
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS pa_pendente ON produto_alteracao (filial_id, criado_em) WHERE status = 'pendente'`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS pa_produto ON produto_alteracao (filial_id, produto_codigo_externo)`);
  await sql.unsafe(`ALTER TABLE produto_alteracao ENABLE ROW LEVEL SECURITY`);
  const rls = await sql<Array<{ r: boolean }>>`
    SELECT c.relrowsecurity r FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='produto_alteracao'`;
  const n = await sql<Array<{ n: number }>>`SELECT count(*)::int n FROM produto_alteracao`;
  console.log(`[ok] produto_alteracao pronta — ${n[0].n} na fila · RLS: ${rls[0]?.r ? 'ligado' : 'DESLIGADO ⚠️'}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
