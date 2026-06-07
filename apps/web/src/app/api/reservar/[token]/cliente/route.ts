// GET /api/reservar/[token]/cliente?tel=...
// Público (token = filial). Dado um telefone, retorna o nome do cliente se ele
// já tem reserva anterior (reconhecimento de cliente recorrente). Best-effort.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) return NextResponse.json({ found: false });

  const [filial] = await db
    .select({ id: schema.filial.id })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) return NextResponse.json({ found: false });

  const tel = new URL(request.url).searchParams.get('tel') ?? '';
  const digitos = tel.replace(/\D/g, '');
  if (digitos.length < 10) return NextResponse.json({ found: false });
  // Casa pelo final do número (DDD + número), ignorando DDI/55 e formatação.
  const local = digitos.slice(-11);

  const [r] = await db
    .select({
      nome: schema.reserva.clienteNome,
      area: schema.reserva.area,
      pessoas: schema.reserva.pessoas,
    })
    .from(schema.reserva)
    .where(
      and(
        sql`regexp_replace(${schema.reserva.clienteTelefone}, '\\D', '', 'g') LIKE ${'%' + local}`,
        sql`${schema.reserva.clienteNome} IS NOT NULL`,
        sql`length(trim(${schema.reserva.clienteNome})) > 1`,
      ),
    )
    .orderBy(desc(schema.reserva.criadoEm))
    .limit(1);

  if (!r?.nome) return NextResponse.json({ found: false });
  return NextResponse.json({
    found: true,
    nome: r.nome,
    area: r.area ?? null,
    pessoas: r.pessoas ?? null,
  });
}
