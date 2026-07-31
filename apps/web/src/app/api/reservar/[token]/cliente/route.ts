// GET /api/reservar/[token]/cliente?tel=...
// Público (token = filial). Dado um telefone, retorna o nome do cliente se ele
// já é conhecido — prioriza o histórico de reservas (mais recente e
// especifico da relação com o concilia) e só cai pro cadastro do Consumer
// (CONTATOS) se a pessoa nunca reservou por aqui. Cadastro do Consumer pode
// ter nome desatualizado (ex: cliente antigo cujo telefone foi reciclado —
// visto em prod), então NÃO tem prioridade sobre um histórico de reservas
// existente. Best-effort.

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

  // 1) Histórico de reservas — o nome mais recente que a própria pessoa deu
  // numa reserva anterior. Mais confiável que o cadastro do Consumer porque é
  // específico dessa relação e tende a estar mais atualizado.
  const [res] = await db
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

  // 2) Sem histórico de reserva: cai pro cadastro de cliente do Consumer
  // (CONTATOS, sincronizado) — útil pra quem já é cliente do PDV mas nunca
  // reservou pelo concilia.
  const r =
    res ??
    (
      await db
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
        .limit(1)
    ).map((c) => ({ nome: c.nome, area: null as string | null, pessoas: null as number | null }))[0];

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

  // Cliente já cadastrado no Consumer sem CPF/CNPJ na ficha? Pede na reserva
  // e atualiza o cadastro (ver /confirmar). Só faz sentido perguntar quando
  // já existe um cadastro pra atualizar (codigoExterno) — cliente 100% novo
  // não tem onde gravar ainda.
  const [cli] = await db
    .select({ cpfOuCnpj: schema.cliente.cpfOuCnpj })
    .from(schema.cliente)
    .where(
      and(
        eq(schema.cliente.filialId, filial.id),
        isNull(schema.cliente.dataDelete),
        sql`regexp_replace(${schema.cliente.telefone}, '\\D', '', 'g') LIKE ${'%' + local}`,
      ),
    )
    .limit(1);
  const precisaCpf = !!cli && !cli.cpfOuCnpj?.trim();

  return NextResponse.json({
    found: true,
    nome: r.nome,
    area: r.area ?? null,
    pessoas: r.pessoas ?? null,
    preferencias: pref?.preferencias ?? null,
    precisaCpf,
  });
}
