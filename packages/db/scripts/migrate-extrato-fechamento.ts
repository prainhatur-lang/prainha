// Extratos bancários do fechamento do mês: as contas de que o extrato é pedido
// (extrato_conta), os arquivos enviados (extrato_arquivo) e o bucket privado
// `extratos-fechamento`. Ver packages/db/src/schema/extrato-fechamento.ts.
//
// Semeia as contas que o dono listou em 12/10/2026 — só quando a tabela está
// vazia, então rodar de novo não recria conta que alguém desligou.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:extrato-fechamento

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const BUCKET = 'extratos-fechamento';
const LIMITE = 50 * 1024 * 1024;

const BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9'; // 01 Prainha Bar
const TABUARA = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7'; // 02 Tabuará
const MAR = 'e899dae2-38bf-4f3f-9149-7effd059fab8'; // 03 Prainha Mar

const CONTAS: Array<{ filialId: string | null; empresa: string | null; banco: string }> = [
  { filialId: BAR, empresa: null, banco: 'Banco do Brasil' },
  { filialId: BAR, empresa: null, banco: 'Itaú' },
  { filialId: BAR, empresa: null, banco: 'Banco do Nordeste' },
  { filialId: BAR, empresa: null, banco: 'Banese' },
  { filialId: BAR, empresa: null, banco: 'Inter' },
  { filialId: TABUARA, empresa: null, banco: 'Inter' },
  { filialId: MAR, empresa: null, banco: 'Inter' },
  { filialId: null, empresa: 'Leles', banco: 'Inter' },
  { filialId: null, empresa: 'E.B. Serviços', banco: 'Inter' },
];

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS extrato_conta (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organizacao_id uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
      filial_id uuid REFERENCES filial(id) ON DELETE CASCADE,
      empresa varchar(80),
      banco varchar(60) NOT NULL,
      apelido varchar(80),
      ordem integer NOT NULL DEFAULT 0,
      ativo boolean NOT NULL DEFAULT true,
      criado_por uuid REFERENCES usuario(id),
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_extrato_conta_org ON extrato_conta (organizacao_id)`);
  await sql.unsafe(`ALTER TABLE extrato_conta ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] extrato_conta pronta (RLS ligado)');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS extrato_arquivo (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conta_id uuid NOT NULL REFERENCES extrato_conta(id) ON DELETE CASCADE,
      ano integer NOT NULL,
      mes integer NOT NULL,
      nome_original text NOT NULL,
      storage_path text NOT NULL UNIQUE,
      content_type varchar(120),
      tamanho_bytes integer,
      enviado_por uuid REFERENCES usuario(id),
      enviado_em timestamptz NOT NULL DEFAULT now(),
      excluido_em timestamptz,
      excluido_por uuid REFERENCES usuario(id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_extrato_arquivo_conta_mes ON extrato_arquivo (conta_id, ano, mes)`);
  await sql.unsafe(`ALTER TABLE extrato_arquivo ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] extrato_arquivo pronta (RLS ligado)');

  const [{ n }] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM extrato_conta`;
  if (n === 0) {
    const [org] = await sql<Array<{ organizacao_id: string }>>`SELECT organizacao_id FROM filial WHERE id = ${BAR}`;
    if (!org) throw new Error('filial 01 (Prainha Bar) nao encontrada');
    let ordem = 0;
    for (const c of CONTAS) {
      ordem += 10;
      await sql`
        INSERT INTO extrato_conta (organizacao_id, filial_id, empresa, banco, ordem)
        VALUES (${org.organizacao_id}, ${c.filialId}, ${c.empresa}, ${c.banco}, ${ordem})
      `;
    }
    console.log(`[ok] ${CONTAS.length} contas semeadas`);
  } else {
    console.log(`[--] extrato_conta ja tem ${n} conta(s); nada semeado`);
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao definidos');
  const supabase = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: buckets, error: errLista } = await supabase.storage.listBuckets();
  if (errLista) throw new Error(`listBuckets: ${errLista.message}`);
  if (buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await supabase.storage.updateBucket(BUCKET, { public: false, fileSizeLimit: LIMITE });
    if (error) throw new Error(`updateBucket: ${error.message}`);
    console.log(`[ok] bucket ${BUCKET} ja existia (privado, 50 MB)`);
  } else {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: LIMITE });
    if (error) throw new Error(`createBucket: ${error.message}`);
    console.log(`[ok] bucket ${BUCKET} criado (privado, 50 MB)`);
  }

  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
