// POST /api/extratos-fechamento/arquivos — passo 2 do envio: registra o extrato
// que o navegador acabou de mandar pro bucket (passo 1 em ../upload-url).
// Confere no bucket que o arquivo chegou antes de gravar a linha — o tamanho
// que vale é o do bucket, não o que o navegador disse.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import {
  BUCKET_EXTRATOS,
  PERM_EXTRATO_ENVIAR,
  contaExtratoVisivel,
  pastaExtrato,
  periodoExtratoValido,
} from '@/lib/extratos-fechamento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await exigirPermApi(PERM_EXTRATO_ENVIAR);
  if (auth.error) return auth.error;

  const body = (await req.json().catch(() => null)) as
    | { contaId?: string; ano?: number; mes?: number; path?: string; nome?: string; contentType?: string }
    | null;
  const contaId = String(body?.contaId ?? '');
  const ano = Number(body?.ano);
  const mes = Number(body?.mes);
  const path = String(body?.path ?? '');
  const nome = String(body?.nome ?? '').trim();

  if (!contaId || !path || !nome) return NextResponse.json({ error: 'dados incompletos' }, { status: 400 });
  if (!periodoExtratoValido(ano, mes)) return NextResponse.json({ error: 'mês inválido' }, { status: 400 });

  const conta = await contaExtratoVisivel(auth.user.id, contaId);
  if (!conta) return NextResponse.json({ error: 'conta não encontrada' }, { status: 404 });

  const pasta = pastaExtrato(conta.id, ano, mes);
  const arquivo = path.slice(pasta.length + 1);
  if (!path.startsWith(`${pasta}/`) || !arquivo || arquivo.includes('/')) {
    return NextResponse.json({ error: 'caminho não confere com a conta e o mês' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const { data: achados, error } = await admin.storage.from(BUCKET_EXTRATOS).list(pasta, { search: arquivo, limit: 100 });
  if (error) return NextResponse.json({ error: `storage: ${error.message}` }, { status: 500 });
  const noBucket = achados?.find((o) => o.name === arquivo);
  if (!noBucket) return NextResponse.json({ error: 'o arquivo não chegou — envie de novo' }, { status: 409 });
  const tamanho = Number((noBucket.metadata as { size?: number } | null)?.size ?? 0) || null;

  const [novo] = await db
    .insert(schema.extratoArquivo)
    .values({
      contaId: conta.id,
      ano,
      mes,
      nomeOriginal: nome.slice(0, 200),
      storagePath: path,
      contentType: body?.contentType ? String(body.contentType).slice(0, 120) : null,
      tamanhoBytes: tamanho,
      enviadoPor: auth.user.id,
    })
    .onConflictDoNothing({ target: schema.extratoArquivo.storagePath })
    .returning({ id: schema.extratoArquivo.id });

  return NextResponse.json({ ok: true, id: novo?.id ?? null });
}
