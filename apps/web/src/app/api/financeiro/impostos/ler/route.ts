// POST /api/financeiro/impostos/ler — multipart com 'arquivo' (PDF ou foto da
// guia). A IA lê tipo, contribuinte, competência, vencimento, valor e código de
// barras; o arquivo vai pro storage e a guia fica LIDA com a proposta de
// rateio. Nada vira conta aqui — isso é o /lancar, depois da conferência.
// Mesmo arquivo de novo devolve a guia que já existe.

import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, ne } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { hashArquivo } from '@/lib/pedido-sem-nota';
import {
  BUCKET_IMPOSTO,
  MIMES_IMPOSTO,
  NaoEGuia,
  PERM_IMPOSTO_LANCAR,
  lerGuia,
  proporRateio,
} from '@/lib/impostos/guia';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const MAX_SIZE = 4 * 1024 * 1024;

function extOf(mime: string): string {
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const negado = await negarSemPerm(user.id, PERM_IMPOSTO_LANCAR);
  if (negado) return negado;

  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    return NextResponse.json({ error: 'use multipart/form-data' }, { status: 400 });
  }
  const form = await req.formData();
  const arquivo = form.get('arquivo');
  if (!(arquivo instanceof File)) return NextResponse.json({ error: 'envie o arquivo da guia' }, { status: 400 });
  if (arquivo.size > MAX_SIZE) {
    return NextResponse.json({ error: 'arquivo maior que 4 MB — tire a foto de novo ou mande o PDF' }, { status: 413 });
  }
  let mime = (arquivo.type || '').toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  if (!mime && arquivo.name.toLowerCase().endsWith('.pdf')) mime = 'application/pdf';
  if (!MIMES_IMPOSTO.has(mime)) {
    return NextResponse.json({ error: `formato não aceito (${mime || 'desconhecido'}) — use PDF, JPG ou PNG` }, { status: 400 });
  }
  const buf = Buffer.from(await arquivo.arrayBuffer());
  const hash = hashArquivo(buf);

  const [existe] = await db.select().from(schema.impostoGuia).where(eq(schema.impostoGuia.arquivoHash, hash)).limit(1);
  if (existe && existe.status !== 'ERRO') {
    const proposta = await proporRateio({
      tipo: (existe.tipo as never) ?? null,
      contribuinteCnpj: existe.contribuinteCnpj,
      competencia: existe.competencia,
    });
    return NextResponse.json({ ok: true, repetida: true, guia: existe, proposta });
  }

  let lida;
  try {
    lida = await lerGuia(buf, mime, arquivo.name);
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: e instanceof NaoEGuia ? 422 : 502 });
  }

  const path = `impostos/${hash}.${extOf(mime)}`;
  const supa = await createAdminClient();
  const up = await supa.storage.from(BUCKET_IMPOSTO).upload(path, buf, { contentType: mime, upsert: true });
  if (up.error) return NextResponse.json({ error: `não guardei o arquivo: ${up.error.message}` }, { status: 500 });

  // Mesmo código de barras já lançado = guia em dobro (o DAM do ISS de 13/08 foi pago 2x).
  let duplicada: { id: string; status: string; lancadoEm: Date | null } | null = null;
  if (lida.codigoBarras) {
    const [d] = await db
      .select({ id: schema.impostoGuia.id, status: schema.impostoGuia.status, lancadoEm: schema.impostoGuia.lancadoEm })
      .from(schema.impostoGuia)
      .where(and(eq(schema.impostoGuia.codigoBarras, lida.codigoBarras), ne(schema.impostoGuia.status, 'DESCARTADA')))
      .limit(1);
    duplicada = d ?? null;
  }

  const proposta = await proporRateio(lida);
  const valores = {
    arquivoPath: path,
    arquivoHash: hash,
    arquivoNome: arquivo.name.slice(0, 200),
    mime,
    lido: lida.bruto,
    erro: null,
    tipo: lida.tipo,
    contribuinteCnpj: lida.contribuinteCnpj,
    contribuinteNome: lida.contribuinteNome?.slice(0, 200) ?? null,
    competencia: lida.competencia,
    vencimento: lida.vencimento,
    valor: lida.valor === null ? null : lida.valor.toFixed(2),
    codigoBarras: lida.codigoBarras,
    descricao: lida.descricao,
    regra: proposta.regra,
    pagadoraFilialId: proposta.pagadoraFilialId,
    pagadoraNome: proposta.pagadoraNome || null,
    status: 'LIDA',
    criadoPor: user.id,
    criadoEm: new Date(),
  };
  const [guia] = existe
    ? await db.update(schema.impostoGuia).set(valores).where(eq(schema.impostoGuia.id, existe.id)).returning()
    : await db.insert(schema.impostoGuia).values(valores).returning();

  return NextResponse.json({ ok: true, guia, proposta, duplicada });
}
