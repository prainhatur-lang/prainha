// PATCH /api/filial/[id]/pix — configurador "Pix por" (pedido do dono 10/11/2026).
// Body: { pixProvedor?: 'cielo'|'rede'|'sicredi'|'inter'|null, pixChave?: string|null }
// pixProvedor NULL = segue o adquirente online, como sempre foi.
// Sicredi/Inter só são aceitos com a credencial da API Pix e a chave prontas:
// Pix exclusivo no banco não pode ficar ligado sem funcionar.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { faltaPraPixBanco } from '@/lib/pix-cob';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  pixProvedor: z.enum(['cielo', 'rede', 'sicredi', 'inter']).nullable().optional(),
  pixChave: z.string().trim().max(77).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('configuracao.editar');
  if (error) return error;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id invalido' }, { status: 400 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, id)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'body invalido' }, { status: 400 });
  const { pixProvedor, pixChave } = parsed.data;

  if (pixChave !== undefined) {
    await db
      .update(schema.filial)
      .set({ pixChave: pixChave ? pixChave : null })
      .where(eq(schema.filial.id, id));
  }

  if (pixProvedor !== undefined) {
    if (pixProvedor === 'sicredi' || pixProvedor === 'inter') {
      const falta = await faltaPraPixBanco(pixProvedor, id);
      if (falta) return NextResponse.json({ error: `Não dá pra ligar: ${falta}.` }, { status: 400 });
    }
    await db.update(schema.filial).set({ pixProvedor: pixProvedor ?? null }).where(eq(schema.filial.id, id));
  }

  return NextResponse.json({ ok: true });
}
