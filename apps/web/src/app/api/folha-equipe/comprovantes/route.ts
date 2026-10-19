// POST /api/folha-equipe/comprovantes — passo 2 do envio: registra a foto que
// o navegador acabou de mandar pro bucket (passo 1 em ./upload-url), LÊ o
// comprovante e casa com a(s) conta(s) FOLHA em aberto. Não dá baixa: a baixa
// é no botão (./baixar). A foto fica guardada mesmo se a leitura falhar.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { BUCKET_LOTERICA, PERM_LOTERICA, lerECasar, pastaLoterica } from '@/lib/comprovante-loterica';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await exigirPermApi(PERM_LOTERICA);
  if (auth.error) return auth.error;

  const body = (await req.json().catch(() => null)) as { path?: string; nome?: string; contentType?: string } | null;
  const path = String(body?.path ?? '');
  const nome = String(body?.nome ?? '').trim();
  if (!path || !nome) return NextResponse.json({ error: 'dados incompletos' }, { status: 400 });

  const pasta = pastaLoterica(auth.user.id);
  const arquivo = path.slice(pasta.length + 1);
  if (!path.startsWith(`${pasta}/`) || !arquivo || arquivo.includes('/')) {
    return NextResponse.json({ error: 'caminho não confere com o usuário' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const { data: achados, error } = await admin.storage.from(BUCKET_LOTERICA).list(pasta, { search: arquivo, limit: 100 });
  if (error) return NextResponse.json({ error: `storage: ${error.message}` }, { status: 500 });
  const noBucket = achados?.find((o) => o.name === arquivo);
  if (!noBucket) return NextResponse.json({ error: 'a foto não chegou — envie de novo' }, { status: 409 });
  const tamanho = Number((noBucket.metadata as { size?: number } | null)?.size ?? 0) || null;

  const [novo] = await db
    .insert(schema.comprovanteLoterica)
    .values({
      nomeOriginal: nome.slice(0, 200),
      storagePath: path,
      contentType: body?.contentType ? String(body.contentType).slice(0, 120) : null,
      tamanhoBytes: tamanho,
      status: 'ERRO',
      erro: 'ainda não foi lido',
      enviadoPor: auth.user.id,
    })
    .onConflictDoNothing({ target: schema.comprovanteLoterica.storagePath })
    .returning({ id: schema.comprovanteLoterica.id });
  if (!novo) return NextResponse.json({ error: 'essa foto já foi registrada' }, { status: 409 });

  const r = await lerECasar(novo.id, auth.user.id);
  return NextResponse.json({ ok: true, id: novo.id, ...r });
}
