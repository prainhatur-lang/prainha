// POST /api/extratos-fechamento/upload-url — passo 1 do envio de um extrato do
// fechamento. Devolve um endereço assinado pra o navegador mandar o arquivo
// DIRETO pro bucket (a função da Vercel não aguenta corpo acima de ~4,5 MB, e
// extrato em PDF passa disso). O passo 2 é POST /api/extratos-fechamento/arquivos.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import {
  BUCKET_EXTRATOS,
  EXTRATO_EXTENSOES,
  EXTRATO_TAMANHO_MAX,
  PERM_EXTRATO_ENVIAR,
  contaExtratoVisivel,
  extensaoExtrato,
  pastaExtrato,
  periodoExtratoValido,
} from '@/lib/extratos-fechamento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await exigirPermApi(PERM_EXTRATO_ENVIAR);
  if (auth.error) return auth.error;

  const body = (await req.json().catch(() => null)) as
    | { contaId?: string; ano?: number; mes?: number; nome?: string; tamanho?: number }
    | null;
  const contaId = String(body?.contaId ?? '');
  const ano = Number(body?.ano);
  const mes = Number(body?.mes);
  const nome = String(body?.nome ?? '').trim();
  const tamanho = Number(body?.tamanho);

  if (!contaId || !nome) return NextResponse.json({ error: 'conta ou arquivo ausente' }, { status: 400 });
  if (!periodoExtratoValido(ano, mes)) return NextResponse.json({ error: 'mês inválido' }, { status: 400 });
  if (!EXTRATO_EXTENSOES.includes(extensaoExtrato(nome))) {
    return NextResponse.json(
      { error: `tipo de arquivo não aceito — envie ${EXTRATO_EXTENSOES.map((e) => e.toUpperCase()).join(', ')}` },
      { status: 400 },
    );
  }
  if (!(tamanho > 0)) return NextResponse.json({ error: 'arquivo vazio' }, { status: 400 });
  if (tamanho > EXTRATO_TAMANHO_MAX) return NextResponse.json({ error: 'arquivo maior que 50 MB' }, { status: 413 });

  const conta = await contaExtratoVisivel(auth.user.id, contaId);
  if (!conta) return NextResponse.json({ error: 'conta não encontrada' }, { status: 404 });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = nome.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${pastaExtrato(conta.id, ano, mes)}/${ts}-${safe}`;

  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_EXTRATOS).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
  }
  return NextResponse.json({ bucket: BUCKET_EXTRATOS, path: data.path, token: data.token });
}
