// FILA DE LANÇAMENTOS DE FIADO (nuvem → loja).
//
// A tela do Concilia (Financeiro > Fiado) não escreve direto no Firebird: a
// loja é que tem o banco, e a nuvem não alcança a loja. Então o lançamento
// entra nesta fila e o vendas-local (que roda lá dentro) busca, aplica na
// CONTACORRENTE e reporta de volta. Mesmo espírito do agente_comando, mas
// executado pelo vendas-local — o agente só sabe atualizar cadastro.
//
// Os três padrões do Consumer (conferidos em 12.480 lançamentos reais):
//   crédito (dívida) : CREDITO=+valor, IMPORTADO='N'  → saldo sobe
//   pagamento        : DEBITO=-valor,  IMPORTADO=null → saldo desce
//   compensação folha: CREDITO=+valor, IMPORTADO='S'  → saldo desce
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fiado-fila

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS fiado_lancamento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      cliente_codigo_externo integer NOT NULL,
      cliente_nome varchar(120),
      tipo varchar(12) NOT NULL,
      valor numeric(14,2) NOT NULL,
      observacao text,
      status varchar(10) NOT NULL DEFAULT 'pendente',
      erro text,
      codigo_externo integer,
      saldo_depois numeric(14,2),
      criado_por varchar(120),
      criado_em timestamptz NOT NULL DEFAULT now(),
      aplicado_em timestamptz
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS fl_pendente ON fiado_lancamento (filial_id, criado_em) WHERE status = 'pendente'`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS fl_cliente ON fiado_lancamento (filial_id, cliente_codigo_externo)`);
  await sql.unsafe(`ALTER TABLE fiado_lancamento ENABLE ROW LEVEL SECURITY`);
  const rls = await sql<Array<{ r: boolean }>>`
    SELECT c.relrowsecurity r FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='fiado_lancamento'`;
  const n = await sql<Array<{ n: number }>>`SELECT count(*)::int n FROM fiado_lancamento`;
  console.log(`[ok] fiado_lancamento pronta — ${n[0].n} na fila · RLS: ${rls[0]?.r ? 'ligado' : 'DESLIGADO ⚠️'}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
