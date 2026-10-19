// POST /api/eb/certificado — certificado A1 da E.B. Serviços (emite a NFS-e).
// Multipart: 'pfx' + 'senha'. Mesmo armazenamento do /api/certificados/upload
// (bucket 'certificados' + certificado_filial com senha cifrada), mas a E.B.
// não está em usuario_filial: quem sobe é quem tem folha_equipe.fechar e
// configuracao.certificado, e o CNPJ do certificado tem que ser o da E.B.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { lerPfx, cifrarSenha } from '@/lib/certificado';
import { EB_CNPJ, configEb } from '@/lib/eb/faturas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm =
    (await negarSemPerm(user.id, 'folha_equipe.fechar')) ??
    (await negarSemPerm(user.id, 'configuracao.certificado'));
  if (semPerm) return semPerm;

  const cfg = await configEb();
  if (!cfg) return NextResponse.json({ error: 'E.B. não cadastrada' }, { status: 500 });

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
  if (info.cnpjOuCpf !== EB_CNPJ) {
    return NextResponse.json(
      { error: `Esse certificado é do CNPJ ${info.cnpjOuCpf ?? '?'} — precisa ser o da E.B. (${EB_CNPJ}).` },
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
