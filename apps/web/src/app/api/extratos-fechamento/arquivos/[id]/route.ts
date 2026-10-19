// GET    /api/extratos-fechamento/arquivos/[id] — baixa o extrato (redireciona
//        pra um endereço assinado do bucket privado, válido por 1 minuto).
//        ?formato=csv: planilha convertida em CSV (";", UTF-8). O contador de
//        fora (grupo só "Contador") sempre recebe a planilha em CSV (19/10/2026).
// DELETE /api/extratos-fechamento/arquivos/[id] — tira o arquivo da lista
//        (enviado errado). Só marca: o arquivo continua guardado no bucket.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ehSoContador } from '@/lib/so-contador';
import { ehPlanilhaExtrato, nomeCsvExtrato } from '@/lib/extrato-planilha';
import {
  BUCKET_EXTRATOS,
  PERM_EXTRATO_ENVIAR,
  PERM_EXTRATO_VER,
  contaExtratoVisivel,
  nomeDownloadExtrato,
} from '@/lib/extratos-fechamento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function arquivoVisivel(userId: string, id: string) {
  if (!UUID.test(id)) return null;
  const [arq] = await db
    .select()
    .from(schema.extratoArquivo)
    .where(and(eq(schema.extratoArquivo.id, id), isNull(schema.extratoArquivo.excluidoEm)))
    .limit(1);
  if (!arq) return null;
  const conta = await contaExtratoVisivel(userId, arq.contaId);
  return conta ? { arq, conta } : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await exigirPermApi(PERM_EXTRATO_VER);
  if (auth.error) return auth.error;
  const { id } = await params;

  const achado = await arquivoVisivel(auth.user.id, id);
  if (!achado) return NextResponse.json({ error: 'extrato não encontrado' }, { status: 404 });
  const { arq, conta } = achado;

  const admin = await createAdminClient();

  const pediuCsv = new URL(req.url).searchParams.get('formato') === 'csv';
  if (ehPlanilhaExtrato(arq.nomeOriginal) && (pediuCsv || (await ehSoContador(auth.user.id)))) {
    const { data: blob, error } = await admin.storage.from(BUCKET_EXTRATOS).download(arq.storagePath);
    if (error || !blob) {
      return NextResponse.json({ error: `storage: ${error?.message ?? 'arquivo não achado'}` }, { status: 500 });
    }
    let csv: string;
    try {
      const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array', cellDates: true });
      // Uma aba vira o CSV inteiro; com mais de uma, cada aba entra com o nome em cima.
      const partes = wb.SheetNames.map((nome) => {
        const corpo = XLSX.utils.sheet_to_csv(wb.Sheets[nome]!, { FS: ';', blankrows: false, dateNF: 'dd/mm/yyyy' });
        return wb.SheetNames.length > 1 ? `${nome}\n${corpo}` : corpo;
      });
      csv = partes.join('\n\n');
    } catch {
      return NextResponse.json({ error: 'não consegui ler a planilha pra converter em CSV' }, { status: 422 });
    }
    const nome = nomeCsvExtrato(nomeDownloadExtrato(conta, arq.ano, arq.mes, arq.nomeOriginal));
    return new NextResponse('\uFEFF' + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nome.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const { data, error } = await admin.storage
    .from(BUCKET_EXTRATOS)
    .createSignedUrl(arq.storagePath, 60, { download: nomeDownloadExtrato(conta, arq.ano, arq.mes, arq.nomeOriginal) });
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: `storage: ${error?.message ?? 'sem endereço'}` }, { status: 500 });
  }
  return NextResponse.redirect(data.signedUrl, 302);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await exigirPermApi(PERM_EXTRATO_ENVIAR);
  if (auth.error) return auth.error;
  const { id } = await params;

  const achado = await arquivoVisivel(auth.user.id, id);
  if (!achado) return NextResponse.json({ error: 'extrato não encontrado' }, { status: 404 });
  const { arq } = achado;

  await db
    .update(schema.extratoArquivo)
    .set({ excluidoEm: new Date(), excluidoPor: auth.user.id })
    .where(eq(schema.extratoArquivo.id, arq.id));
  return NextResponse.json({ ok: true });
}
