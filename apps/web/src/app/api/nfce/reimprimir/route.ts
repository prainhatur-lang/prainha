// POST /api/nfce/reimprimir — enfileira a 2ª via do DANFE pra sair na
// TÉRMICA da loja (o vendas-local puxa a fila a cada ~20s e imprime).
// O browser não alcança a impressora da filial; a loja alcança.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ id: z.string().uuid() });

export async function POST(request: Request) {
  const auth = await exigirPermApi('nfce.read');
  if (auth.error) return auth.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'body inválido' }, { status: 400 });

  const [nota] = await db
    .select({
      id: schema.nfceEmitida.id,
      filialId: schema.nfceEmitida.filialId,
      status: schema.nfceEmitida.status,
    })
    .from(schema.nfceEmitida)
    .where(eq(schema.nfceEmitida.id, parsed.data.id))
    .limit(1);
  if (!nota) return NextResponse.json({ ok: false, erro: 'nota não encontrada' }, { status: 404 });

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, auth.user.id),
        eq(schema.usuarioFilial.filialId, nota.filialId),
      ),
    )
    .limit(1);
  if (!acesso) return NextResponse.json({ ok: false, erro: 'sem acesso' }, { status: 403 });

  if (nota.status !== 'AUTORIZADA') {
    return NextResponse.json(
      { ok: false, erro: 'DANFE cancelado/não autorizado não se reimprime' },
      { status: 422 },
    );
  }

  // dedupe: já tem pedido de impressão pendente? não empilha outro
  const [pendente] = await db
    .select({ id: schema.nfceReimpressao.id })
    .from(schema.nfceReimpressao)
    .where(
      and(
        eq(schema.nfceReimpressao.nfceId, nota.id),
        eq(schema.nfceReimpressao.status, 'PENDENTE'),
      ),
    )
    .limit(1);
  if (pendente) return NextResponse.json({ ok: true, jaNaFila: true });

  await db.insert(schema.nfceReimpressao).values({
    filialId: nota.filialId,
    nfceId: nota.id,
    solicitadoPor: auth.user.email?.slice(0, 60) ?? null,
  });
  return NextResponse.json({ ok: true });
}
