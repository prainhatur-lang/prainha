// POST /api/upload — recebe FormData multipart com arquivo + filialId + tipo (opcional)
// Auth via cookie (Supabase). Verifica RBAC do usuario na filial.

import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import {
  processarCieloVendas,
  processarCieloRecebiveis,
  processarCnab240Inter,
  detectarTipo,
} from '@/lib/processadores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // Vercel: 60s no Pro

const BUCKET = 'arquivos-importacao';
const TIPOS_VALIDOS = ['CIELO_VENDAS', 'CIELO_RECEBIVEIS', 'CNAB240_INTER'] as const;
type Tipo = (typeof TIPOS_VALIDOS)[number];

export async function POST(req: Request) {
  // 1. Auth
  const supa = await createClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2. Parse FormData
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'multipart invalido' }, { status: 400 });
  }
  const file = form.get('arquivo');
  const filialId = String(form.get('filialId') ?? '');
  const tipoSolicitado = form.get('tipo')?.toString();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'arquivo ausente' }, { status: 400 });
  }
  if (!filialId) {
    return NextResponse.json({ error: 'filialId ausente' }, { status: 400 });
  }
  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: 'arquivo > 50MB' }, { status: 413 });
  }

  // 3. RBAC: usuario tem acesso a filial?
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)),
    )
    .limit(1);
  if (!link) {
    return NextResponse.json({ error: 'sem acesso a esta filial' }, { status: 403 });
  }

  // 4. Le bytes
  const buf = Buffer.from(await file.arrayBuffer());

  // 5. Detecta tipo (override pelo solicitado, se valido)
  let tipo: Tipo | null = null;
  if (tipoSolicitado && (TIPOS_VALIDOS as readonly string[]).includes(tipoSolicitado)) {
    tipo = tipoSolicitado as Tipo;
  } else {
    tipo = detectarTipo(buf);
  }
  if (!tipo) {
    return NextResponse.json(
      {
        error: 'nao foi possivel identificar o tipo do arquivo. Selecione manualmente.',
      },
      { status: 400 },
    );
  }

  // 6. Sobe pro Storage
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${filialId}/${tipo}/${ts}-${safe}`;
  const admin = await createAdminClient();
  const up = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (up.error) {
    return NextResponse.json({ error: `storage: ${up.error.message}` }, { status: 500 });
  }

  // 7. Cria row de tracking
  const [arq] = await db
    .insert(schema.arquivoImportacao)
    .values({
      filialId,
      tipo,
      nomeOriginal: file.name,
      storagePath: path,
      tamanhoBytes: file.size,
      status: 'PROCESSANDO',
      enviadoPor: user.id,
    })
    .returning({ id: schema.arquivoImportacao.id });

  // 8. Processa inline
  try {
    let resumo;
    switch (tipo) {
      case 'CIELO_VENDAS':
        resumo = await processarCieloVendas(filialId, buf, path);
        break;
      case 'CIELO_RECEBIVEIS':
        resumo = await processarCieloRecebiveis(filialId, buf, path);
        break;
      case 'CNAB240_INTER':
        resumo = await processarCnab240Inter(filialId, buf, path);
        break;
    }

    await db
      .update(schema.arquivoImportacao)
      .set({
        status: 'OK',
        registrosProcessados: resumo.registrosInseridos,
        resumo: resumo as unknown as Record<string, unknown>,
        processadoEm: new Date(),
      })
      .where(eq(schema.arquivoImportacao.id, arq!.id));

    return NextResponse.json({
      id: arq!.id,
      tipo,
      status: 'OK',
      resumo,
    });
  } catch (e: unknown) {
    const msg = (e as Error).message ?? 'erro desconhecido';
    await db
      .update(schema.arquivoImportacao)
      .set({ status: 'ERRO', erro: msg, processadoEm: new Date() })
      .where(eq(schema.arquivoImportacao.id, arq!.id));
    return NextResponse.json({ error: msg, id: arq!.id }, { status: 500 });
  }
}
