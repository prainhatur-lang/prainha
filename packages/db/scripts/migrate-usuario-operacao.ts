// Cadastro ÚNICO de quem trabalha no salão (caixa, comanda, KDS).
//
// CONTEXTO (19/08/2026): existiam TRÊS cadastros — o do Consumer (PDV), o
// "criado aqui" da loja e o do app web. Criar o Paulão virou caça ao tesouro:
// o dono cadastrou num lugar e o login não entrava no outro. Decisão dele:
// cadastro na NUVEM, espelhado pra loja (a loja segue funcionando sem
// internet, lendo a cópia local).
//
// Guarda o PIN como HASH (scrypt + salt) — o mesmo formato que a loja já usa
// em garcom_pin/usuario_local, então o espelho é cópia direta, sem conversão.
// As permissões são os MESMOS códigos do PDV (10 = tela de pagamentos, 12 =
// desconto/taxas, 53 = comanda mobile...), pra regra do sistema continuar uma
// só e a migração não reescrever significado.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:usuario-operacao

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS usuario_operacao (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      login varchar(30) NOT NULL,
      nome varchar(80) NOT NULL,
      pin_hash text NOT NULL,
      salt text NOT NULL,
      perms integer[] NOT NULL DEFAULT '{}',
      admin boolean NOT NULL DEFAULT false,
      ativo boolean NOT NULL DEFAULT true,
      origem varchar(12) NOT NULL DEFAULT 'nuvem',
      codigo_pdv integer,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      criado_por varchar(80)
    )`);
  // login é único DENTRO da filial: "bar" pode existir na Prainha e no Tabuará
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uop_filial_login ON usuario_operacao (filial_id, lower(login))`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS uop_filial ON usuario_operacao (filial_id) WHERE ativo`);
  // ⚠️ SEM RLS a anon key do Supabase lê os hashes de PIN pelo PostREST.
  await sql.unsafe(`ALTER TABLE usuario_operacao ENABLE ROW LEVEL SECURITY`);

  const n = await sql<Array<{ n: number }>>`SELECT count(*)::int n FROM usuario_operacao`;
  const rls = await sql<Array<{ r: boolean }>>`
    SELECT c.relrowsecurity r FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname='public' AND c.relname='usuario_operacao'`;
  console.log(`[ok] usuario_operacao pronta — ${n[0].n} usuário(s) · RLS: ${rls[0]?.r ? 'ligado' : 'DESLIGADO ⚠️'}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
