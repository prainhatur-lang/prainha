// POST /api/nota-boleto/[token]/upload — upload publico de boleto via token.
// Usado pela pagina mobile /nota-boleto/[token] (sem login).
//
// Fluxo:
// 1. Salva arquivo no Storage (bucket producao-fotos, prefixo nfe-boletos/).
// 2. Insere linha em nota_compra_boleto_pendente.
// 3. Chama OCR (Claude Vision) pra extrair vencimento + valor — atualiza
//    a linha com o resultado.
// 4. Soma valores ja extraidos (deste boleto + anteriores da mesma nota).
// 5. Retorna pro mobile:
//      - dados extraidos
//      - total acumulado vs total da NFe
//      - falta R$ X (precisa mais boleto?) ou ✓ tudo fechado.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { randomBytes } from 'node:crypto';
import { extrairDadosBoleto } from '@/lib/ocr-boleto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30; // OCR pode levar 5-10s

const BUCKET = 'producao-fotos';
const MAX_SIZE = 10 * 1024 * 1024;
const MIMES_OK = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const TOLERANCIA_CENTAVO = 0.01;

function extOf(mime: string): string {
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic') || mime.includes('heif')) return 'heic';
  return 'jpg';
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'token invalido' }, { status: 400 });
  }

  const [nota] = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      valorTotal: schema.notaCompra.valorTotal,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.boletoTokenPublico, token))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'token nao encontrado' }, { status: 404 });

  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'use multipart/form-data' }, { status: 400 });
  }
  const form = await req.formData();
  const arquivo = form.get('arquivo');
  if (!(arquivo instanceof File)) {
    return NextResponse.json({ error: 'arquivo ausente' }, { status: 400 });
  }
  if (arquivo.size > MAX_SIZE) {
    return NextResponse.json(
      { error: `arquivo > ${MAX_SIZE / 1024 / 1024}MB` },
      { status: 413 },
    );
  }
  if (!MIMES_OK.has(arquivo.type.toLowerCase())) {
    return NextResponse.json(
      { error: `tipo nao suportado: ${arquivo.type}` },
      { status: 400 },
    );
  }

  // 1. Upload no Storage
  const ext = extOf(arquivo.type);
  const random = randomBytes(8).toString('hex');
  const ts = Date.now();
  const storagePath = `nfe-boletos/${nota.filialId}/${nota.id}/${ts}-${random}.${ext}`;
  const buffer = Buffer.from(await arquivo.arrayBuffer());

  const supa = await createAdminClient();
  const up = await supa.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: arquivo.type,
    upsert: false,
  });
  if (up.error) {
    return NextResponse.json(
      { error: `storage: ${up.error.message}` },
      { status: 500 },
    );
  }

  // 2. Insere row em boletos pendentes (sem OCR ainda)
  const [pendente] = await db
    .insert(schema.notaCompraBoletoPendente)
    .values({
      filialId: nota.filialId,
      notaCompraId: nota.id,
      storagePath,
    })
    .returning({ id: schema.notaCompraBoletoPendente.id });

  // 3. OCR — so funciona pra imagem (PDF nao). Best-effort: erro nao quebra upload.
  const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(storagePath);
  const ehImagem = arquivo.type.startsWith('image/');
  let ocrResult = null;
  if (ehImagem && pendente) {
    ocrResult = await extrairDadosBoleto(pub.publicUrl);
    await db
      .update(schema.notaCompraBoletoPendente)
      .set({
        dataVencimentoExtraida: ocrResult.dataVencimento,
        valorExtraido: ocrResult.valor != null ? String(ocrResult.valor) : null,
        confiancaOcr: ocrResult.confianca,
        observacaoOcr: ocrResult.observacao,
      })
      .where(eq(schema.notaCompraBoletoPendente.id, pendente.id));
  }

  // 4. Soma valores extraidos de todos os pendentes da nota
  const [agregado] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${schema.notaCompraBoletoPendente.valorExtraido}), 0)::text`,
      qtd: sql<number>`COUNT(*)::int`,
    })
    .from(schema.notaCompraBoletoPendente)
    .where(eq(schema.notaCompraBoletoPendente.notaCompraId, nota.id));

  const totalLido = Number(agregado?.total ?? 0);
  const totalNFe = Number(nota.valorTotal ?? 0);
  const falta = Math.max(0, totalNFe - totalLido);
  const fechouTotal =
    totalNFe > 0 ? Math.abs(totalNFe - totalLido) <= TOLERANCIA_CENTAVO : false;

  return NextResponse.json({
    storagePath,
    url: pub.publicUrl,
    tamanhoBytes: arquivo.size,
    ocr: ocrResult,
    boletos: {
      qtd: agregado?.qtd ?? 0,
      totalLido,
      totalNFe,
      falta,
      fechouTotal,
    },
  });
}
