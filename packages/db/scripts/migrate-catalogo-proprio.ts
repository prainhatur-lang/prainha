// PRÉ-DESLIGAMENTO DO CONSUMER (0001): o que só existia no Firebird passa a
// ter casa no nosso banco.
//
// O dono desliga o Firebird da 0001 esta semana. O espelho por CDC já cobre
// produto, tamanho, ficha, complemento, cliente, pedido e pagamento — mas
// TRÊS coisas que a operação usa todo dia nunca vieram:
//
//   COZINHAS              → area_producao   (as praças do KDS)
//   OBSERVACOES +         → observacao_pdv  ("bem passada", "sem cebola" —
//   ETIQUETASOBSERVACOES                     ligadas à CATEGORIA, não ao item)
//   VWUSUARIOS + ACESSO   → usuario_operacao (já existia; PIN vira nulo)
//
// O PIN do Consumer é cifra de bloco com chave no .exe e não foi revertido
// (ver memory ral-senha-cifra) — então usuário importado entra SEM pin_hash e
// precisa de PIN próprio antes do corte. Por isso as colunas viram nulas: o
// registro existe (nome, perms, código) mesmo sem senha conhecida.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:catalogo-proprio

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS area_producao (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      codigo_externo integer NOT NULL,
      nome varchar(80) NOT NULL,
      ativa boolean NOT NULL DEFAULT true,
      sincronizado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_area_producao UNIQUE (filial_id, codigo_externo)
    )`);
  await sql.unsafe(`ALTER TABLE area_producao ENABLE ROW LEVEL SECURITY`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS observacao_pdv (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      codigo_externo integer NOT NULL,
      texto varchar(120) NOT NULL,
      codigo_etiqueta integer,
      categoria varchar(100),
      sincronizado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_observacao_pdv UNIQUE (filial_id, codigo_externo, codigo_etiqueta)
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS obs_pdv_cat ON observacao_pdv (filial_id, codigo_etiqueta)`);
  await sql.unsafe(`ALTER TABLE observacao_pdv ENABLE ROW LEVEL SECURITY`);

  // Usuário importado do Consumer não tem PIN conhecido — precisa cadastrar.
  await sql.unsafe(`ALTER TABLE usuario_operacao ALTER COLUMN pin_hash DROP NOT NULL`);
  await sql.unsafe(`ALTER TABLE usuario_operacao ALTER COLUMN salt DROP NOT NULL`);
  await sql.unsafe(`ALTER TABLE usuario_operacao ADD COLUMN IF NOT EXISTS tipo varchar(30)`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_usuario_operacao_login ON usuario_operacao (filial_id, lower(login))`);

  const r = await sql<Array<{ t: string; n: number; rls: boolean }>>`
    SELECT c.relname t, c.relrowsecurity rls,
      (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)::int n
    FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname='public' AND c.relname IN ('area_producao','observacao_pdv','usuario_operacao')
    ORDER BY 1`;
  for (const x of r) console.log(`[ok] ${x.t} — ${x.n} colunas · RLS: ${x.rls ? 'ligado' : 'DESLIGADO ⚠️'}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
