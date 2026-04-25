// POST /api/nota-boleto/[token]/upload — upload publico de boleto via token.
// Usado pela pagina mobile /nota-boleto/[token] (sem login).
//
// Resolve a nota pelo token, salva arquivo no Storage, e:
//  1. Anexa o storagePath em TODAS as conta_pagar com origem='NFE' dessa nota
//     que estao sem boleto (atualizacao em massa).
//  2. Se ainda nao tem nenhuma conta_pagar (user vai criar parcelas depois),
//     guarda o path em uma observacao temporaria? Ou nada — proximo POST de
//     parcelas-manuais consulta este path? Por simplicidade, gravamos a primeira
//     foto no campo... Hmm.
//
// Decisao: salvar sempre no Storage e retornar storagePath. O PC, ao criar
// parcelas-manuais depois, ja recebe o storagePath via uma rota auxiliar
// (GET /api/nota-compra/[id]/boleto-pendente) que retorna o ultimo upload.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

  // 1. Anexa em TODAS as conta_pagar JA EXISTENTES dessa nota sem boleto
  //    (caso o user ja tenha lancado e so depois mandou foto)
  await db
    .update(schema.contaPagar)
    .set({ boletoStoragePath: storagePath })
    .where(
      and(
        eq(schema.contaPagar.notaCompraId, nota.id),
        eq(schema.contaPagar.origem, 'NFE'),
        isNull(schema.contaPagar.boletoStoragePath),
      ),
    );

  // 2. Salva tambem na nota.boletoPendentePath. Isso eh o caso comum:
  //    user esta no PC com modal aberto, manda link pro celular, sobe foto
  //    ANTES de clicar Confirmar. Ainda nao existe conta_pagar pra atualizar.
  //    Quando o user confirmar, /parcelas-manuais le esse campo.
  await db
    .update(schema.notaCompra)
    .set({ boletoPendentePath: storagePath })
    .where(eq(schema.notaCompra.id, nota.id));

  const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(storagePath);
  return NextResponse.json({
    storagePath,
    url: pub.publicUrl,
    tamanhoBytes: arquivo.size,
  });
}
