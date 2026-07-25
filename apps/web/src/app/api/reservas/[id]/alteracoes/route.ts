// GET /api/reservas/[id]/alteracoes — historico de auditoria da reserva
// (quem mudou o que e quando). Escopado as filiais do usuario.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('reserva.read');
  if (error) return error;

  const { id } = await params;
  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  if (filialIds.length === 0) return NextResponse.json({ error: 'sem filiais' }, { status: 403 });

  const [res] = await db
    .select({ id: schema.reserva.id })
    .from(schema.reserva)
    .where(and(eq(schema.reserva.id, id), inArray(schema.reserva.filialId, filialIds)))
    .limit(1);
  if (!res) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });

  const linhas = await db
    .select({
      campo: schema.reservaAlteracao.campo,
      valorAnterior: schema.reservaAlteracao.valorAnterior,
      valorNovo: schema.reservaAlteracao.valorNovo,
      autorTipo: schema.reservaAlteracao.autorTipo,
      autorNome: schema.reservaAlteracao.autorNome,
      criadoEm: schema.reservaAlteracao.criadoEm,
    })
    .from(schema.reservaAlteracao)
    .where(eq(schema.reservaAlteracao.reservaId, id))
    .orderBy(desc(schema.reservaAlteracao.criadoEm))
    .limit(100);

  return NextResponse.json({ alteracoes: linhas });
}
