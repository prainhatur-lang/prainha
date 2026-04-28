// POST /api/op/[token]/entrada — cozinheiro adiciona insumo que pegou
// pra producao. Auth via token publico (sem login).
//
// Diferencas pra rota de saida:
//  - precoUnitario eh derivado automatico do produto.precoCusto. Cozinheiro
//    nao informa custo — gestor confia no MPM atual do estoque.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.number().positive(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'token invalido' }, { status: 400 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [op] = await db
    .select({
      id: schema.ordemProducao.id,
      filialId: schema.ordemProducao.filialId,
      status: schema.ordemProducao.status,
    })
    .from(schema.ordemProducao)
    .where(eq(schema.ordemProducao.tokenPublico, token))
    .limit(1);
  if (!op) return NextResponse.json({ error: 'OP nao encontrada' }, { status: 404 });
  if (op.status !== 'RASCUNHO') {
    return NextResponse.json(
      { error: `OP ${op.status} — nao aceita mais edicao` },
      { status: 400 },
    );
  }

  // Carrega o produto pra validar filial + pegar custo
  const [prod] = await db
    .select({
      id: schema.produto.id,
      filialId: schema.produto.filialId,
      precoCusto: schema.produto.precoCusto,
    })
    .from(schema.produto)
    .where(eq(schema.produto.id, parsed.data.produtoId))
    .limit(1);
  if (!prod) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });
  if (prod.filialId !== op.filialId) {
    return NextResponse.json({ error: 'produto em filial diferente' }, { status: 400 });
  }

  const precoUnit = Number(prod.precoCusto ?? 0);
  const valorTotal = precoUnit * parsed.data.quantidade;

  // NAO faz auto-fill de pesoTotalKg na entrada — o cozinheiro pesa na balanca
  // o quanto pegou de fato (pode ser diferente de qtd × pesoUnitarioPadrao).
  // O campo pesoUnitarioPadraoKg do produto eh so info de cadastro.

  const [created] = await db
    .insert(schema.ordemProducaoEntrada)
    .values({
      ordemProducaoId: op.id,
      produtoId: prod.id,
      quantidade: parsed.data.quantidade.toFixed(4),
      precoUnitario: precoUnit > 0 ? precoUnit.toFixed(6) : null,
      valorTotal: precoUnit > 0 ? valorTotal.toFixed(2) : null,
    })
    .returning({ id: schema.ordemProducaoEntrada.id });

  return NextResponse.json({ id: created?.id }, { status: 201 });
}
