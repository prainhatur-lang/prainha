// POST /api/cartoes/faturas — passo 2 do envio: registra a fatura que o
// navegador acabou de mandar pro bucket (passo 1 em ../upload-url) e LÊ os
// lançamentos. Confere no bucket que o arquivo chegou antes de gravar.
// O arquivo fica guardado mesmo se a leitura falhar — a fatura entra na lista
// com o erro e o botão "ler de novo".

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { BUCKET_CARTOES, PERM_CARTAO_ENVIAR, acessoCartoes, lerEGravarFatura, pastaCartao } from '@/lib/cartao-fatura';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await exigirPermApi(PERM_CARTAO_ENVIAR);
  if (auth.error) return auth.error;
  const acesso = await acessoCartoes(auth.user.id);
  if (!acesso) return NextResponse.json({ error: 'sem acesso às faturas de cartão da empresa' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { path?: string; nome?: string; contentType?: string } | null;
  const path = String(body?.path ?? '');
  const nome = String(body?.nome ?? '').trim();
  if (!path || !nome) return NextResponse.json({ error: 'dados incompletos' }, { status: 400 });

  const pasta = pastaCartao(acesso.organizacaoId);
  const arquivo = path.slice(pasta.length + 1);
  if (!path.startsWith(`${pasta}/`) || !arquivo || arquivo.includes('/')) {
    return NextResponse.json({ error: 'caminho não confere com a empresa' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const { data: achados, error } = await admin.storage.from(BUCKET_CARTOES).list(pasta, { search: arquivo, limit: 100 });
  if (error) return NextResponse.json({ error: `storage: ${error.message}` }, { status: 500 });
  const noBucket = achados?.find((o) => o.name === arquivo);
  if (!noBucket) return NextResponse.json({ error: 'o arquivo não chegou — envie de novo' }, { status: 409 });
  const tamanho = Number((noBucket.metadata as { size?: number } | null)?.size ?? 0) || null;

  const [nova] = await db
    .insert(schema.cartaoFatura)
    .values({
      organizacaoId: acesso.organizacaoId,
      nomeOriginal: nome.slice(0, 200),
      storagePath: path,
      contentType: body?.contentType ? String(body.contentType).slice(0, 120) : null,
      tamanhoBytes: tamanho,
      status: 'ERRO',
      erro: 'ainda não foi lida',
      enviadoPor: auth.user.id,
    })
    .onConflictDoNothing({ target: schema.cartaoFatura.storagePath })
    .returning({ id: schema.cartaoFatura.id });
  if (!nova) return NextResponse.json({ error: 'esse arquivo já foi registrado' }, { status: 409 });

  const leitura = await lerEGravarFatura(nova.id, auth.user.id);
  return NextResponse.json({ ok: true, id: nova.id, ...leitura });
}
