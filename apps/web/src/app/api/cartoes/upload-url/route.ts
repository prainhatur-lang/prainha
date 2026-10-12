// POST /api/cartoes/upload-url — passo 1 do envio de uma fatura de cartão.
// Devolve um endereço assinado pra o navegador mandar o arquivo DIRETO pro
// bucket (a função da Vercel não aguenta corpo acima de ~4,5 MB). O passo 2 é
// POST /api/cartoes/faturas, que registra e lê a fatura.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import {
  BUCKET_CARTOES,
  CARTAO_EXTENSOES,
  CARTAO_TAMANHO_MAX,
  PERM_CARTAO_ENVIAR,
  acessoCartoes,
  extensaoCartao,
  pastaCartao,
} from '@/lib/cartao-fatura';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await exigirPermApi(PERM_CARTAO_ENVIAR);
  if (auth.error) return auth.error;
  const acesso = await acessoCartoes(auth.user.id);
  if (!acesso) return NextResponse.json({ error: 'sem acesso às faturas de cartão da empresa' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { nome?: string; tamanho?: number } | null;
  const nome = String(body?.nome ?? '').trim();
  const tamanho = Number(body?.tamanho);
  if (!nome) return NextResponse.json({ error: 'arquivo ausente' }, { status: 400 });
  if (!CARTAO_EXTENSOES.includes(extensaoCartao(nome))) {
    return NextResponse.json(
      { error: `tipo de arquivo não aceito — envie ${CARTAO_EXTENSOES.map((e) => e.toUpperCase()).join(', ')}` },
      { status: 400 },
    );
  }
  if (!(tamanho > 0)) return NextResponse.json({ error: 'arquivo vazio' }, { status: 400 });
  if (tamanho > CARTAO_TAMANHO_MAX) return NextResponse.json({ error: 'arquivo maior que 20 MB' }, { status: 413 });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = nome.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${pastaCartao(acesso.organizacaoId)}/${ts}-${safe}`;

  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_CARTOES).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
  }
  return NextResponse.json({ bucket: BUCKET_CARTOES, path: data.path, token: data.token });
}
