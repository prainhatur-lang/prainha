// GET /api/nfce/xmls?filial=<uuid>&mes=YYYY-MM — ZIP com os XMLs (nfeProc)
// das NFC-e do mês, pro contador escriturar. Autorizadas e canceladas.
// Resposta em streaming (mês cheio passa fácil do teto de body da Vercel).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ZipStore } from '@/lib/nfce/zip-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = await exigirPermApi('nfce.read');
  if (auth.error) return auth.error;

  const sp = new URL(request.url).searchParams;
  const filialId = sp.get('filial') || '';
  const mes = sp.get('mes') || '';
  if (!/^[0-9a-f-]{36}$/i.test(filialId) || !/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: 'use ?filial=<uuid>&mes=YYYY-MM' }, { status: 400 });
  }

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, auth.user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Fronteiras do mês em BRT (-03:00)
  const [ano, m] = mes.split('-').map(Number) as [number, number];
  const inicio = new Date(`${mes}-01T00:00:00-03:00`);
  const fim = new Date(`${m === 12 ? ano + 1 : ano}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00-03:00`);

  const zip = new ZipStore();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let offset = 0;
        let total = 0;
        for (;;) {
          const lote = await db
            .select({
              chave: schema.nfceEmitida.chave,
              xml: schema.nfceEmitida.xml,
              status: schema.nfceEmitida.status,
              quando: schema.nfceEmitida.autorizadaEm,
            })
            .from(schema.nfceEmitida)
            .where(
              and(
                eq(schema.nfceEmitida.filialId, filialId),
                inArray(schema.nfceEmitida.status, ['AUTORIZADA', 'CANCELADA']),
                isNotNull(schema.nfceEmitida.xml),
                gte(schema.nfceEmitida.autorizadaEm, inicio),
                lt(schema.nfceEmitida.autorizadaEm, fim),
              ),
            )
            .orderBy(asc(schema.nfceEmitida.autorizadaEm))
            .limit(200)
            .offset(offset);
          if (lote.length === 0) break;
          for (const n of lote) {
            const nome = `${n.chave}${n.status === 'CANCELADA' ? '-cancelada' : ''}.xml`;
            controller.enqueue(zip.arquivo(nome, Buffer.from(n.xml!, 'utf8'), n.quando ?? undefined));
            total++;
          }
          offset += lote.length;
        }
        if (total === 0) {
          controller.enqueue(
            zip.arquivo('SEM-NOTAS.txt', Buffer.from(encoder.encode(`Nenhuma NFC-e em ${mes}.`))),
          );
        }
        controller.enqueue(zip.fim());
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="NFCe-${mes}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
