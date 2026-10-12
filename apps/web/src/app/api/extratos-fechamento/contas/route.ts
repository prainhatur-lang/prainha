// POST /api/extratos-fechamento/contas — põe mais uma conta na lista das que
// têm extrato pedido no fechamento do mês. A conta é de uma casa (filialId) ou
// de empresa do grupo que não é uma das casas (empresa).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { PERM_EXTRATO_ENVIAR, destinosNovaContaExtrato } from '@/lib/extratos-fechamento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await exigirPermApi(PERM_EXTRATO_ENVIAR);
  if (auth.error) return auth.error;

  const body = (await req.json().catch(() => null)) as
    | { filialId?: string; empresa?: string; banco?: string; apelido?: string }
    | null;
  const filialId = String(body?.filialId ?? '').trim();
  const empresa = String(body?.empresa ?? '').trim();
  const banco = String(body?.banco ?? '').trim();
  const apelido = String(body?.apelido ?? '').trim();

  if (!banco) return NextResponse.json({ error: 'informe o banco' }, { status: 400 });
  if (banco.length > 60 || apelido.length > 80 || empresa.length > 80) {
    return NextResponse.json({ error: 'nome comprido demais' }, { status: 400 });
  }

  const destinos = await destinosNovaContaExtrato(auth.user.id);
  let organizacaoId: string;
  if (filialId) {
    const filial = destinos.filiais.find((f) => f.id === filialId);
    if (!filial) return NextResponse.json({ error: 'sem acesso a esta casa' }, { status: 403 });
    organizacaoId = filial.organizacaoId;
  } else {
    if (!empresa) return NextResponse.json({ error: 'informe a casa ou o nome da empresa' }, { status: 400 });
    if (!destinos.organizacaoEmpresas) {
      return NextResponse.json({ error: 'conta de outra empresa só pra quem acessa todas as casas' }, { status: 403 });
    }
    organizacaoId = destinos.organizacaoEmpresas;
  }

  const [{ prox }] = await db
    .select({ prox: sql<number>`COALESCE(MAX(${schema.extratoConta.ordem}), 0)::int + 10` })
    .from(schema.extratoConta)
    .where(eq(schema.extratoConta.organizacaoId, organizacaoId));

  const [nova] = await db
    .insert(schema.extratoConta)
    .values({
      organizacaoId,
      filialId: filialId || null,
      empresa: filialId ? null : empresa,
      banco,
      apelido: apelido || null,
      ordem: prox,
      criadoPor: auth.user.id,
    })
    .returning({ id: schema.extratoConta.id });

  return NextResponse.json({ ok: true, id: nova!.id });
}
