// GET /api/nota-compra/[id]/boletos-pendentes
// Lista todos os boletos enviados pra essa nota (multiplas fotos quando
// a NFe tem varias parcelas) com OCR ja extraido. Usado pelo modal de
// Lancar via polling pra atualizar UI quando user envia foto pelo celular.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';
import { createAdminClient, createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'producao-fotos';
const TOLERANCIA_CENTAVO = 0.01;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const [nota] = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      valorTotal: schema.notaCompra.valorTotal,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, nota.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const pendentes = await db
    .select({
      id: schema.notaCompraBoletoPendente.id,
      storagePath: schema.notaCompraBoletoPendente.storagePath,
      dataVencimentoExtraida: schema.notaCompraBoletoPendente.dataVencimentoExtraida,
      valorExtraido: schema.notaCompraBoletoPendente.valorExtraido,
      confiancaOcr: schema.notaCompraBoletoPendente.confiancaOcr,
      observacaoOcr: schema.notaCompraBoletoPendente.observacaoOcr,
      enviadoEm: schema.notaCompraBoletoPendente.enviadoEm,
    })
    .from(schema.notaCompraBoletoPendente)
    .where(eq(schema.notaCompraBoletoPendente.notaCompraId, id))
    .orderBy(asc(schema.notaCompraBoletoPendente.enviadoEm));

  const supa = await createAdminClient();
  const boletos = pendentes.map((p) => {
    const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(p.storagePath);
    return {
      id: p.id,
      storagePath: p.storagePath,
      url: pub.publicUrl,
      dataVencimento: p.dataVencimentoExtraida,
      valor: p.valorExtraido != null ? Number(p.valorExtraido) : null,
      confianca: p.confiancaOcr,
      observacao: p.observacaoOcr,
      enviadoEm: p.enviadoEm,
    };
  });

  const totalLido = boletos.reduce((s, b) => s + (b.valor ?? 0), 0);
  const totalNFe = Number(nota.valorTotal ?? 0);
  const falta = Math.max(0, totalNFe - totalLido);
  const fechouTotal =
    totalNFe > 0 ? Math.abs(totalNFe - totalLido) <= TOLERANCIA_CENTAVO : false;

  return NextResponse.json({
    boletos,
    qtd: boletos.length,
    totalLido,
    totalNFe,
    falta,
    fechouTotal,
  });
}
