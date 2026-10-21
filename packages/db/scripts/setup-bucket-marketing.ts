// Cria o bucket PRIVADO 'marketing-midia' (fotos e vídeos da tela /marketing →
// Publicar). O navegador sobe direto por link assinado; o Instagram lê por link
// assinado do Storage e o TikTok pelo nosso domínio (/api/marketing/arquivo).
// Uso: pnpm --filter @concilia/db setup:bucket-marketing

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao definidos');

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const NOME = 'marketing-midia';
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];

async function main() {
  const { data: existentes } = await supabase.storage.listBuckets();
  const ja = existentes?.find((b) => b.name === NOME);
  // tenta 500 MB; se o projeto tiver teto menor, cai pra 50 MB
  for (const limite of [500, 50]) {
    const cfg = { public: false, fileSizeLimit: limite * 1024 * 1024, allowedMimeTypes: TIPOS };
    const { error } = ja ? await supabase.storage.updateBucket(NOME, cfg) : await supabase.storage.createBucket(NOME, cfg);
    if (!error) {
      console.log(`OK: bucket ${NOME} ${ja ? 'atualizado' : 'criado'} (privado, ${limite} MB por arquivo)`);
      return;
    }
    console.error(`  ${limite} MB: ${error.message}`);
  }
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
