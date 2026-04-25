// Cria bucket 'producao-fotos' no Supabase Storage como público
// (URLs são longas/aleatórias via storage_path = filialId/opId/uuid.jpg).

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao definidos');
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("Garantindo bucket 'producao-fotos'...");
  const { data: existentes } = await supabase.storage.listBuckets();
  const ja = existentes?.find((b) => b.name === 'producao-fotos');

  if (ja) {
    console.log('  ja existe — atualizando config pra publico');
    const { error } = await supabase.storage.updateBucket('producao-fotos', {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024, // 10MB
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
    });
    if (error) {
      console.error('  erro:', error.message);
      process.exit(1);
    }
  } else {
    const { error } = await supabase.storage.createBucket('producao-fotos', {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
    });
    if (error) {
      console.error('  erro:', error.message);
      process.exit(1);
    }
    console.log('  criado');
  }
  console.log('OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
