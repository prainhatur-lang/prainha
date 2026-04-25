// POST /api/nota-compra/[id]/parcelas-manuais
// Cria conta_pagar manualmente quando a NFe nao traz <cobr><dup> no XML.
// Usado quando: (a) compra com boleto fora do XML, (b) parcelamento informal,
// (c) compra que vai ser paga depois e o user quer rastrear.
//
// Body:
//   {
//     categoriaId: uuid,
//     parcelas: [{ dataVencimento: 'YYYY-MM-DD', valor: number }, ...],
//     boletoStoragePath?: string (opcional — anexa o boleto digitalizado)
//   }
//
// Idempotente: se a nota ja tem conta_pagar com origem='NFE' e essa nota
// nao foi excluida, recusa pra nao duplicar (user deve apagar antes).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  categoriaId: z.string().uuid().nullable().optional(),
  boletoStoragePath: z.string().max(500).nullable().optional(),
  parcelas: z
    .array(
      z.object({
        dataVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data invalida'),
        valor: z.number().positive(),
      }),
    )
    .min(1, 'pelo menos 1 parcela')
    .max(60, 'maximo 60 parcelas'),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [nota] = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      fornecedorId: schema.notaCompra.fornecedorId,
      numero: schema.notaCompra.numero,
      boletoPendentePath: schema.notaCompra.boletoPendentePath,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, nota.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  if (!nota.fornecedorId) {
    return NextResponse.json(
      { error: 'nota sem fornecedor — vincule um fornecedor antes de criar contas a pagar' },
      { status: 400 },
    );
  }

  // Checa se ja existem contas a pagar dessa nota (evita duplicar)
  const existentes = await db
    .select({ id: schema.contaPagar.id })
    .from(schema.contaPagar)
    .where(
      and(
        eq(schema.contaPagar.notaCompraId, id),
        eq(schema.contaPagar.origem, 'NFE'),
      ),
    );
  if (existentes.length > 0) {
    return NextResponse.json(
      {
        error: `nota ja tem ${existentes.length} conta(s) a pagar criada(s) — apague-as antes de criar novas`,
      },
      { status: 409 },
    );
  }

  const { categoriaId, parcelas, boletoStoragePath } = parsed.data;
  const total = parcelas.length;
  // Se o body nao trouxe o path (modo "celular"), usa o que veio do upload
  // mobile salvo na nota.
  const boletoFinal = boletoStoragePath ?? nota.boletoPendentePath ?? null;

  const criadas: { id: string }[] = [];
  for (let i = 0; i < parcelas.length; i++) {
    const p = parcelas[i];
    const descricao = nota.numero
      ? `NFe nº ${nota.numero}${total > 1 ? ` — parcela ${i + 1}/${total}` : ''}`
      : `NFe parcela ${i + 1}/${total}`;
    const [novo] = await db
      .insert(schema.contaPagar)
      .values({
        filialId: nota.filialId,
        origem: 'NFE',
        notaCompraId: id,
        fornecedorId: nota.fornecedorId,
        categoriaId: categoriaId ?? null,
        parcela: i + 1,
        totalParcelas: total,
        dataVencimento: p.dataVencimento,
        valor: String(p.valor),
        descricao,
        boletoStoragePath: boletoFinal,
      })
      .returning({ id: schema.contaPagar.id });
    if (novo) criadas.push(novo);
  }

  // Limpa o pendente — ja foi consumido. Evita reaproveitar em re-lancamentos.
  if (nota.boletoPendentePath) {
    await db
      .update(schema.notaCompra)
      .set({ boletoPendentePath: null })
      .where(eq(schema.notaCompra.id, id));
  }

  return NextResponse.json({
    ok: true,
    contasCriadas: criadas.length,
    boletoAnexado: boletoFinal != null,
  });
}
