// Espelho do WIZARD do Consumer — as "perguntas" que aparecem depois de
// escolher o produto (carne do sol -> qual acompanhamento?).
//
// É assim que a casa faz acompanhamento de verdade: a opção pode ser só uma
// observação OU lançar um produto filho, e tem PRECOPROMO — o preço quando
// vai junto do prato, diferente do avulso.
//
// Uso: pnpm --filter @concilia/db migrate:wizard

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function run<T>(n: string, f: () => Promise<T>) {
  process.stdout.write(`  ${n}... `);
  const r = await f();
  console.log('OK');
  return r;
}

async function main() {
  await run('wizard_pergunta', () =>
    sql`
      CREATE TABLE IF NOT EXISTS wizard_pergunta (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        codigo_externo integer NOT NULL,
        texto varchar(200),
        respostas_min integer NOT NULL DEFAULT 0,
        respostas_max integer NOT NULL DEFAULT 0,
        sincronizado_em timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_wizard_pergunta UNIQUE (filial_id, codigo_externo)
      )`,
  );
  await run('wizard_opcao', () =>
    sql`
      CREATE TABLE IF NOT EXISTS wizard_opcao (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        codigo_externo integer NOT NULL,
        codigo_pergunta integer NOT NULL,
        nome varchar(200),
        preco_promo numeric(10,2) NOT NULL DEFAULT 0,
        codigo_variante_externo integer,
        variante_id uuid REFERENCES produto_variante(id) ON DELETE SET NULL,
        sincronizado_em timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_wizard_opcao UNIQUE (filial_id, codigo_externo)
      )`,
  );
  await run('wizard_produto', () =>
    sql`
      CREATE TABLE IF NOT EXISTS wizard_produto (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        codigo_variante_externo integer NOT NULL,
        codigo_pergunta integer NOT NULL,
        ordem integer NOT NULL DEFAULT 0,
        variante_id uuid REFERENCES produto_variante(id) ON DELETE SET NULL,
        sincronizado_em timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_wizard_produto UNIQUE (filial_id, codigo_variante_externo, codigo_pergunta)
      )`,
  );
  for (const t of ['wizard_pergunta', 'wizard_opcao', 'wizard_produto']) {
    await run(`RLS ${t}`, () => sql.unsafe(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`));
  }
  await run('idx wizard_produto', () =>
    sql`CREATE INDEX IF NOT EXISTS wizard_produto_var_idx ON wizard_produto (filial_id, variante_id)`,
  );
  await run('idx wizard_opcao', () =>
    sql`CREATE INDEX IF NOT EXISTS wizard_opcao_perg_idx ON wizard_opcao (filial_id, codigo_pergunta)`,
  );
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
