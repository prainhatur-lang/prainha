// POST /api/nota-compra/[id]/pagamento-xml
// Nota que veio da SEFAZ antes de 14/10/2026 ficou sem as parcelas (<cobr>) e
// sem a forma de pagamento (<pag>) do XML. O modal "Lançar no estoque" chama
// isto UMA vez ao abrir: consulta a chave na SEFAZ e grava as parcelas — aí a
// nota não pede boleto, só confirma. Depois de lida não consulta de novo.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';
import { lerPagamentoXmlPorChave } from '@/lib/nfe-distribuicao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
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
    .select({ filialId: schema.notaCompra.filialId })
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

  let r;
  try {
    r = await lerPagamentoXmlPorChave({ notaCompraId: id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 300) }, { status: 502 });
  }

  const [depois] = await db
    .select({ pagamentoXml: schema.notaCompra.pagamentoXml })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  const duplicatas = await db
    .select({
      id: schema.notaCompraDuplicata.id,
      numero: schema.notaCompraDuplicata.numero,
      dataVencimento: schema.notaCompraDuplicata.dataVencimento,
      valor: schema.notaCompraDuplicata.valor,
      contaPagarId: schema.notaCompraDuplicata.contaPagarId,
    })
    .from(schema.notaCompraDuplicata)
    .where(eq(schema.notaCompraDuplicata.notaCompraId, id))
    .orderBy(asc(schema.notaCompraDuplicata.dataVencimento));

  return NextResponse.json({
    ...r,
    pagamentoXml: depois?.pagamentoXml ?? null,
    duplicatas: duplicatas.map((d) => ({
      id: d.id,
      numero: d.numero,
      dataVencimento: d.dataVencimento,
      valor: d.valor,
      jaCriadaContaPagar: d.contaPagarId != null,
    })),
  });
}
