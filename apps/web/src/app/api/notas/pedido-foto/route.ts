// POST /api/notas/pedido-foto
// Body: multipart/form-data com 'arquivo' (foto JPG/PNG/WEBP ou PDF) + 'filialId'
//
// Pedido SEM NOTA: guarda a foto, a IA lê fornecedor, itens e valores, e grava
// como nota_compra (origem PEDIDO_FOTO) + itens + parcela. O estoque e a conta
// a pagar saem do /api/nota-compra/[id]/lancar-estoque de sempre — a tela chama
// em seguida quando `pronto` vem true (tudo reconhecido e a soma bate).
// Idempotente: mesma foto de novo devolve o pedido que já existe.

import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import {
  BUCKET_PEDIDO,
  MIMES_PEDIDO,
  NotaServicoLida,
  catalogoDaFilial,
  chaveDoPedido,
  fornecedorDoServico,
  gravarNotaServico,
  gravarPedido,
  hashArquivo,
  lerPedido,
} from '@/lib/pedido-sem-nota';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const MAX_SIZE = 4 * 1024 * 1024; // a tela já reduz a foto; acima disso a Vercel nem entrega o corpo

function extOf(mime: string): string {
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    return NextResponse.json({ error: 'use multipart/form-data' }, { status: 400 });
  }
  const form = await req.formData();
  const filialId = (form.get('filialId') as string | null) ?? '';
  const arquivo = form.get('arquivo');
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId invalido' }, { status: 400 });
  }
  if (!(arquivo instanceof File)) {
    return NextResponse.json({ error: 'arquivo ausente' }, { status: 400 });
  }
  const mime = arquivo.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : arquivo.type.toLowerCase();
  if (!MIMES_PEDIDO.has(mime)) {
    return NextResponse.json({ error: `tipo não suportado (${arquivo.type || 'desconhecido'}) — envie foto JPG/PNG ou PDF` }, { status: 400 });
  }
  if (arquivo.size > MAX_SIZE) {
    return NextResponse.json({ error: 'arquivo acima de 4 MB' }, { status: 413 });
  }

  // RBAC — mesmo critério do upload de XML
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const buf = Buffer.from(await arquivo.arrayBuffer());
  const hash = hashArquivo(buf);

  const [existente] = await db
    .select({ id: schema.notaCompra.id, emitNome: schema.notaCompra.emitNome })
    .from(schema.notaCompra)
    .where(and(eq(schema.notaCompra.filialId, filialId), eq(schema.notaCompra.chave, chaveDoPedido(hash))))
    .limit(1);
  if (existente) {
    return NextResponse.json({ ok: true, id: existente.id, duplicada: true, emitNome: existente.emitNome });
  }

  // Lê antes de guardar: foto que não é pedido não deixa arquivo órfão no bucket.
  const cat = await catalogoDaFilial(filialId);
  let lido;
  try {
    lido = await lerPedido(buf, mime, arquivo.name, cat);
  } catch (e) {
    // Nota de serviço (NFS-e): sem insumo, vai direto pro contas a pagar.
    if (e instanceof NotaServicoLida) {
      const s = e.lido;
      if (!fornecedorDoServico(s, cat)) {
        return NextResponse.json(
          {
            error: `é uma nota de serviço de ${s.fornecedorNome ?? 'fornecedor não identificado'}${s.fornecedorCnpj ? ` (CNPJ ${s.fornecedorCnpj})` : ''}, mas esse fornecedor não está no cadastro desta casa — cadastre em Cadastros → Fornecedores e envie de novo`,
          },
          { status: 422 },
        );
      }
      if (!(Number(s.total) > 0)) {
        return NextResponse.json({ error: 'é uma nota de serviço, mas não deu pra ler o valor total' }, { status: 422 });
      }
      const pathServico = `pedidos-sem-nota/${filialId}/${hash}.${extOf(mime)}`;
      const supaServico = await createAdminClient();
      const upServico = await supaServico.storage
        .from(BUCKET_PEDIDO)
        .upload(pathServico, buf, { contentType: mime, upsert: true });
      if (upServico.error) {
        return NextResponse.json({ error: `storage: ${upServico.error.message}` }, { status: 500 });
      }
      const rs = await gravarNotaServico({ filialId, lido: s, cat, hash, storagePath: pathServico, usuarioId: user.id });
      return NextResponse.json({ ok: true, servico: true, ...rs });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }

  const storagePath = `pedidos-sem-nota/${filialId}/${hash}.${extOf(mime)}`;
  const supa = await createAdminClient();
  const up = await supa.storage.from(BUCKET_PEDIDO).upload(storagePath, buf, { contentType: mime, upsert: true });
  if (up.error) {
    return NextResponse.json({ error: `storage: ${up.error.message}` }, { status: 500 });
  }

  const r = await gravarPedido({ filialId, lido, cat, hash, storagePath });
  return NextResponse.json({ ok: true, ...r });
}
