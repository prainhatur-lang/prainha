// GET /api/reservar/[token]/cliente?tel=...
// Público (token = filial). Dado um telefone, retorna o nome do cliente se ele
// já é conhecido — casa contra o cadastro do Consumer (cliente, mais
// autoritativo) e, se não achar lá, contra reservas anteriores. Best-effort.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

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

  // 1) Cadastro de cliente do Consumer (CONTATOS, sincronizado) — fonte mais
  // autoritativa: é o cadastro real do PDV, não só um nome digitado numa
  // reserva antiga.
  const [cli] = await db
    .select({ nome: schema.cliente.nome })
    .from(schema.cliente)
    .where(
      and(
        eq(schema.cliente.filialId, filial.id),
        isNull(schema.cliente.dataDelete),
        sql`regexp_replace(${schema.cliente.telefone}, '\\D', '', 'g') LIKE ${'%' + local}`,
        sql`${schema.cliente.nome} IS NOT NULL`,
        sql`length(trim(${schema.cliente.nome})) > 1`,
      ),
    )
    .limit(1);

  const r = cli
    ? { nome: cli.nome, area: null as string | null, pessoas: null as number | null }
    : (
        await db
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
          .limit(1)
      )[0];

  if (!r?.nome) return NextResponse.json({ found: false });

  // Preferências mais recentes não-vazias desse cliente (segue o telefone).
  const [pref] = await db
    .select({ preferencias: schema.reserva.preferencias })
    .from(schema.reserva)
    .where(
      and(
        sql`regexp_replace(${schema.reserva.clienteTelefone}, '\\D', '', 'g') LIKE ${'%' + local}`,
        sql`${schema.reserva.preferencias} IS NOT NULL`,
        sql`length(trim(${schema.reserva.preferencias})) > 1`,
      ),
    )
    .orderBy(desc(schema.reserva.criadoEm))
    .limit(1);

  return NextResponse.json({
    found: true,
    nome: r.nome,
    area: r.area ?? null,
    pessoas: r.pessoas ?? null,
    preferencias: pref?.preferencias ?? null,
  });
}
