// POST /api/nota-chave/enviar   Body: { f, e, s, chave }
// Chamado pela câmera do celular (/nota-chave, sem login — o link assinado
// é a autenticação) assim que lê a chave: traz a nota da SEFAZ na hora, igual
// ao "Trazer nota" da Entrada de notas (importarPorChave).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { importarPorChave } from '@/lib/nfe-distribuicao';
import { validarLinkNotaChave } from '@/lib/nota-chave-link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { f?: string; e?: number; s?: string; chave?: string };
  const filialId = validarLinkNotaChave(body.f, body.e, body.s);
  if (!filialId) {
    return NextResponse.json({ error: 'link vencido — gere outro QR na Entrada de notas' }, { status: 401 });
  }
  const chave = String(body.chave ?? '').replace(/\D/g, '');
  if (chave.length !== 44) return NextResponse.json({ error: 'chave precisa de 44 números' }, { status: 400 });

  try {
    const r = await importarPorChave({ filialId, chave });
    const [nota] = await db
      .select({
        id: schema.notaCompra.id,
        numero: schema.notaCompra.numero,
        emitNome: schema.notaCompra.emitNome,
        valorTotal: schema.notaCompra.valorTotal,
      })
      .from(schema.notaCompra)
      .where(and(eq(schema.notaCompra.filialId, filialId), eq(schema.notaCompra.chave, chave)))
      .limit(1);
    // o computador do QR acompanha por aqui e abre a nota sozinho
    await db
      .insert(schema.notaChaveLeitura)
      .values({ filialId, linkE: Number(body.e), chave, notaCompraId: nota?.id ?? null, status: r.status })
      .catch((err) => console.error('[nota-chave] gravar leitura', err));
    return NextResponse.json({ ok: true, ...r, nota: nota ?? null });
  } catch (e) {
    return NextResponse.json({ error: `erro trazendo a nota: ${(e as Error).message}` }, { status: 500 });
  }
}
