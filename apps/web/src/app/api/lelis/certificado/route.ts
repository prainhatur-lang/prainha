// POST /api/lelis/certificado — certificado A1 da Lelis (emite a NF-e de venda).
// Multipart: 'pfx' + 'senha'. Mesmo armazenamento do /api/certificados/upload
// (bucket certificados + certificado_filial com senha cifrada); a Lelis
// não está em usuario_filial: só o Admin sobe, e o CNPJ do certificado
// tem que ser o da Lelis. Cópia de /api/eb/certificado (01/11/2026).
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { lerPfx, cifrarSenha } from '@/lib/certificado';
import { LELIS_CNPJ } from '@/lib/impostos/guia';
import { acessoLelisApi } from '@/lib/lelis/acesso';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const cfg = { filialId: a.filialId };
  const user = { id: a.userId };

  const form = await req.formData().catch(() => null);
  const senha = form?.get('senha');
  const file = form?.get('pfx');
  if (typeof senha !== 'string' || !senha) return NextResponse.json({ error: 'senha obrigatória' }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: 'arquivo .pfx obrigatório' }, { status: 400 });

  const pfxBytes = Buffer.from(await file.arrayBuffer());
  let info;
  try {
    info = lerPfx(pfxBytes, senha);
  } catch (e) {
    return NextResponse.json(
      { error: `Não deu pra abrir o certificado: senha errada ou arquivo inválido (${(e as Error).message})` },
      { status: 400 },
    );
  }
  if (info.cnpjOuCpf !== LELIS_CNPJ) {
    return NextResponse.json(
      { error: `Esse certificado é do CNPJ ${info.cnpjOuCpf ?? '?'} — precisa ser o da Lelis (${LELIS_CNPJ}).` },
      { status: 400 },
    );
  }
  if (info.validadeFim.getTime() < Date.now()) {
    return NextResponse.json({ error: 'Certificado vencido.' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const storagePath = `${cfg.filialId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: upErr } = await admin.storage
    .from('certificados')
    .upload(storagePath, pfxBytes, { contentType: 'application/x-pkcs12', upsert: false });
  if (upErr) return NextResponse.json({ error: `erro ao subir arquivo: ${upErr.message}` }, { status: 500 });

  const senhaCifrada = cifrarSenha(senha);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.certificadoFilial)
      .set({ ativo: false })
      .where(and(eq(schema.certificadoFilial.filialId, cfg.filialId), eq(schema.certificadoFilial.ativo, true)));
    await tx.insert(schema.certificadoFilial).values({
      filialId: cfg.filialId,
      cnpjCertificado: info.cnpjOuCpf,
      cn: info.cn,
      pfxStoragePath: storagePath,
      senhaCifrada,
      validadeInicio: info.validadeInicio.toISOString().slice(0, 10),
      validadeFim: info.validadeFim.toISOString().slice(0, 10),
      nomeArquivo: file.name,
      ativo: true,
      compartilharOrganizacao: false,
      uploadadoPor: user.id,
    });
  });

  return NextResponse.json({ ok: true, cn: info.cn, validadeFim: info.validadeFim.toISOString().slice(0, 10) });
}
