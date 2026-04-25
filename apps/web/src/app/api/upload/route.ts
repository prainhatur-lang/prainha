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
  extrairEcsCielo,
  validarEcsContraFilial,
} from '@/lib/processadores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // Vercel: 60s no Pro

const BUCKET = 'arquivos-importacao';
const TIPOS_VALIDOS = ['CIELO_VENDAS', 'CIELO_RECEBIVEIS', 'CNAB240_INTER'] as const;
type Tipo = (typeof TIPOS_VALIDOS)[number];

function labelTipo(t: Tipo): string {
  switch (t) {
    case 'CIELO_VENDAS':
      return 'Cielo - Vendas Detalhado';
    case 'CIELO_RECEBIVEIS':
      return 'Cielo - Recebíveis';
    case 'CNAB240_INTER':
      return 'CNAB 240 Inter';
  }
}

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

  // 5. Detecta tipo real do conteudo. Sempre roda, mesmo quando user selecionou
  //    manualmente — assim corrigimos auto-matico se o usuario errou o dropdown
  //    (ex: escolheu "Vendas Detalhado" mas subiu arquivo de "Recebiveis").
  const tipoDetectado = detectarTipo(buf);
  let tipoSolicitadoNormalizado: Tipo | null = null;
  if (tipoSolicitado && (TIPOS_VALIDOS as readonly string[]).includes(tipoSolicitado)) {
    tipoSolicitadoNormalizado = tipoSolicitado as Tipo;
  }

  let tipo: Tipo | null = null;
  let avisoAutoCorrigido: string | null = null;

  if (tipoDetectado) {
    // Prioriza o tipo REAL detectado pelo conteudo
    tipo = tipoDetectado;
    if (
      tipoSolicitadoNormalizado &&
      tipoSolicitadoNormalizado !== tipoDetectado
    ) {
      avisoAutoCorrigido = `Voce selecionou "${labelTipo(tipoSolicitadoNormalizado)}" mas o arquivo e "${labelTipo(tipoDetectado)}". Processado como ${labelTipo(tipoDetectado)}.`;
    }
  } else if (tipoSolicitadoNormalizado) {
    // Nao deu pra detectar mas user escolheu — tenta respeitar (pode falhar no parser)
    tipo = tipoSolicitadoNormalizado;
  }

  if (!tipo) {
    return NextResponse.json(
      {
        error:
          'nao foi possivel identificar o tipo do arquivo. Confirme que eh o CSV original da Cielo (vendas ou recebiveis) ou o .RET CNAB 240 do Banco Inter.',
      },
      { status: 400 },
    );
  }

  // 5b. Validação de EC (apenas pra arquivos Cielo).
  // Bloqueia upload cruzado (EC pertence a outra filial) e pede confirmação
  // explícita pra ECs novos (ainda nunca vistos nessa filial).
  // O frontend reenvia o request com confirmarEcsNovos=true depois de o user clicar OK.
  if (tipo === 'CIELO_VENDAS' || tipo === 'CIELO_RECEBIVEIS') {
    const ecs = extrairEcsCielo(buf, tipo);
    if (ecs.length > 0) {
      const validacao = await validarEcsContraFilial(filialId, ecs);
      if (validacao.conflitos.length > 0) {
        const c = validacao.conflitos[0]!;
        return NextResponse.json(
          {
            error: `Este arquivo é do EC ${c.ec}, que pertence à filial "${c.filialNome}". Selecione a filial correta antes de subir.`,
            ecConflito: c,
            ecsNoArquivo: ecs,
          },
          { status: 409 },
        );
      }
      const confirmou = form.get('confirmarEcsNovos')?.toString() === 'true';
      if (validacao.novos.length > 0 && !confirmou) {
        return NextResponse.json(
          {
            error: 'EC_NOVO_REQUER_CONFIRMACAO',
            mensagem: `Este arquivo tem ${validacao.novos.length === 1 ? 'um EC novo' : `${validacao.novos.length} ECs novos`} pra esta filial: ${validacao.novos.join(', ')}. Confirma que ${validacao.novos.length === 1 ? 'pertence' : 'pertencem'} à filial selecionada?`,
            ecsNovos: validacao.novos,
            ecsJaConhecidos: validacao.jaConhecidos,
          },
          { status: 422 },
        );
      }
    }
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
      aviso: avisoAutoCorrigido ?? undefined,
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
