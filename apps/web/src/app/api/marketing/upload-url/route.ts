// POST /api/marketing/upload-url { filialId, nome, tamanho, tipo } — passo 1 do
// envio de foto/vídeo da tela Publicar: endereço assinado pro navegador mandar o
// arquivo DIRETO pro bucket marketing-midia (a Vercel não aguenta corpo grande).

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { acessoMarketingApi } from '@/lib/marketing/acesso';
import { BUCKET_MARKETING } from '@/lib/marketing/midia-link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Limite de arquivo do projeto no Supabase (Storage → Settings). */
const MAX = 50 * 1024 * 1024;
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { filialId?: string; nome?: string; tamanho?: number; tipo?: string };
  const a = await acessoMarketingApi(b.filialId);
  if (a.error) return a.error;
  const tipo = String(b.tipo ?? '');
  if (!TIPOS.includes(tipo)) return NextResponse.json({ error: 'Envie foto (JPG/PNG) ou vídeo (MP4/MOV).' }, { status: 400 });
  const tamanho = Number(b.tamanho);
  if (!(tamanho > 0)) return NextResponse.json({ error: 'arquivo vazio' }, { status: 400 });
  if (tamanho > MAX) return NextResponse.json({ error: 'Arquivo maior que 50 MB.' }, { status: 413 });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = String(b.nome ?? 'arquivo').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `${a.casa.id}/${ts}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_MARKETING).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
  return NextResponse.json({ bucket: BUCKET_MARKETING, path: data.path, token: data.token });
}
