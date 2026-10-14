// GET /api/nota-chave/chegaram?filialId=&desde=<ISO>
// O painel do QR na Entrada de notas pergunta de tempos em tempos quais notas
// entraram (ou viraram completas) desde que ele abriu — pra atualizar a lista
// sozinho enquanto o celular vai lendo as chaves.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, notLike, or } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const filialId = url.searchParams.get('filialId') ?? '';
  const desde = new Date(url.searchParams.get('desde') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(filialId) || Number.isNaN(desde.getTime())) {
    return NextResponse.json({ error: 'parametros invalidos' }, { status: 400 });
  }
  const [link] = await db
    .select({ role: schema.usuarioFilial.role })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const notas = await db
    .select({
      id: schema.notaCompra.id,
      numero: schema.notaCompra.numero,
      emitNome: schema.notaCompra.emitNome,
      valorTotal: schema.notaCompra.valorTotal,
      origem: schema.notaCompra.origemImportacao,
    })
    .from(schema.notaCompra)
    .where(
      and(
        eq(schema.notaCompra.filialId, filialId),
        or(
          gte(schema.notaCompra.criadoEm, desde),
          // resumo que virou completa (a tentativa sem sucesso também mexe no
          // atualizado_em, mas continua RESUMO)
          and(gte(schema.notaCompra.atualizadoEm, desde), notLike(schema.notaCompra.origemImportacao, 'SEFAZ_DFE_RESUMO%')),
        ),
      ),
    )
    .orderBy(desc(schema.notaCompra.atualizadoEm))
    .limit(30);

  // &e= (validade do link do QR): o que o celular desse QR leu — inclusive
  // nota que já estava no sistema. A mais nova primeiro.
  const linkE = Number(url.searchParams.get('e'));
  const lidas = Number.isInteger(linkE) && linkE > 0
    ? await db
        .select({
          id: schema.notaChaveLeitura.id,
          notaId: schema.notaChaveLeitura.notaCompraId,
          status: schema.notaChaveLeitura.status,
          numero: schema.notaCompra.numero,
          emitNome: schema.notaCompra.emitNome,
          valorTotal: schema.notaCompra.valorTotal,
          origem: schema.notaCompra.origemImportacao,
        })
        .from(schema.notaChaveLeitura)
        .leftJoin(schema.notaCompra, eq(schema.notaCompra.id, schema.notaChaveLeitura.notaCompraId))
        .where(and(eq(schema.notaChaveLeitura.filialId, filialId), eq(schema.notaChaveLeitura.linkE, linkE)))
        .orderBy(desc(schema.notaChaveLeitura.criadoEm))
        .limit(30)
    : [];
  return NextResponse.json({ ok: true, notas, lidas });
}
