// POST /api/certificados/upload
// Body: multipart/form-data com 'pfx' (arquivo .pfx) + 'senha' + 'filialId'
//
// - Valida a senha lendo o PFX (extrai CNPJ, CN, validade)
// - Sobe pfx pro Supabase Storage bucket privado 'certificados'
// - Cifra a senha com AES-256-GCM e grava em certificado_filial
// - Desativa certificado anterior da mesma filial (se houver)

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { lerPfx, cifrarSenha } from '@/lib/certificado';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'use multipart/form-data' }, { status: 400 });
  }

  const form = await req.formData();
  const filialId = form.get('filialId') as string | null;
  const senha = form.get('senha') as string | null;
  const file = form.get('pfx');

  if (!filialId || !/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId invalido' }, { status: 400 });
  }
  if (!senha || senha.length < 1) {
    return NextResponse.json({ error: 'senha obrigatoria' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'arquivo pfx obrigatorio' }, { status: 400 });
  }

  // RBAC: só DONO da filial
  const [link] = await db
    .select({ role: schema.usuarioFilial.role })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!link || link.role !== 'DONO') {
    return NextResponse.json({ error: 'so DONO da filial pode subir certificado' }, { status: 403 });
  }

  // Lê o PFX e valida a senha
  const pfxBytes = Buffer.from(await file.arrayBuffer());
  let info;
  try {
    info = lerPfx(pfxBytes, senha);
  } catch (e) {
    return NextResponse.json(
      { error: `nao foi possivel ler o PFX: senha errada ou arquivo invalido (${(e as Error).message})` },
      { status: 400 },
    );
  }

  // Valida: CNPJ do cert deve bater com CNPJ da filial (ou ser mesma raiz)
  const [fil] = await db
    .select({ cnpj: schema.filial.cnpj })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  if (!fil) return NextResponse.json({ error: 'filial nao encontrada' }, { status: 404 });

  if (info.cnpjOuCpf && fil.cnpj) {
    // Mesma raiz (8 primeiros dígitos) — certs de matriz funcionam pra filiais
    if (info.cnpjOuCpf.slice(0, 8) !== fil.cnpj.slice(0, 8)) {
      return NextResponse.json(
        {
          error: `CNPJ do certificado (${info.cnpjOuCpf}) nao bate com raiz da filial (${fil.cnpj}).`,
        },
        { status: 400 },
      );
    }
  }

  // Sobe arquivo pro Storage
  const admin = createAdminClient(SUPABASE_URL, SERVICE_KEY);
  const storagePath = `${filialId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: uploadError } = await admin.storage
    .from('certificados')
    .upload(storagePath, pfxBytes, {
      contentType: 'application/x-pkcs12',
      upsert: false,
    });
  if (uploadError) {
    return NextResponse.json(
      { error: `erro ao subir arquivo: ${uploadError.message}` },
      { status: 500 },
    );
  }

  // Cifra a senha
  let senhaCifrada: string;
  try {
    senhaCifrada = cifrarSenha(senha);
  } catch (e) {
    return NextResponse.json(
      { error: `env CERTIFICATE_SECRET nao configurado: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  // Desativa anterior
  await db
    .update(schema.certificadoFilial)
    .set({ ativo: false })
    .where(
      and(
        eq(schema.certificadoFilial.filialId, filialId),
        eq(schema.certificadoFilial.ativo, true),
      ),
    );

  // Insere novo
  const [novo] = await db
    .insert(schema.certificadoFilial)
    .values({
      filialId,
      cnpjCertificado: info.cnpjOuCpf,
      cn: info.cn,
      pfxStoragePath: storagePath,
      senhaCifrada,
      validadeInicio: info.validadeInicio.toISOString().slice(0, 10),
      validadeFim: info.validadeFim.toISOString().slice(0, 10),
      nomeArquivo: file.name,
      ativo: true,
      uploadadoPor: user.id,
    })
    .returning({ id: schema.certificadoFilial.id });

  return NextResponse.json({
    ok: true,
    id: novo!.id,
    cn: info.cn,
    cnpj: info.cnpjOuCpf,
    validadeFim: info.validadeFim.toISOString().slice(0, 10),
  });
}
