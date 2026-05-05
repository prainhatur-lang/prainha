// POST /api/cotacao/preencher/[token]
// Endpoint publico (sem auth). Fornecedor submete preço/marca por item via token unico.
//
// Body: { respostas: Array<{ cotacaoItemId, precoUnitario, marca, observacao }> }
//   - precoUnitario null/undefined = nao tem o item
//   - respostas vazio = nao tem nada essa semana
// Marca o cotacao_fornecedor como RESPONDIDA. Idempotente: re-submeter substitui as respostas.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

interface Body {
  respostas: Array<{
    cotacaoItemId: string;
    precoUnitario: number;
    marca: string | null;
    observacao: string | null;
  }>;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const [cf] = await db
    .select()
    .from(schema.cotacaoFornecedor)
    .where(eq(schema.cotacaoFornecedor.tokenPublico, token))
    .limit(1);
  if (!cf) return NextResponse.json({ error: 'token invalido' }, { status: 404 });

  // Verifica se cotacao ainda esta aberta
  const [cot] = await db
    .select({
      id: schema.cotacao.id,
      filialId: schema.cotacao.filialId,
      status: schema.cotacao.status,
      fechaEm: schema.cotacao.fechaEm,
    })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, cf.cotacaoId))
    .limit(1);
  if (!cot) return NextResponse.json({ error: 'cotacao nao encontrada' }, { status: 404 });
  if (cot.status === 'CANCELADA') {
    return NextResponse.json({ error: 'cotacao cancelada' }, { status: 410 });
  }
  if (cot.fechaEm && new Date() > new Date(cot.fechaEm)) {
    return NextResponse.json({ error: 'cotacao expirou' }, { status: 410 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }

  const respostas = Array.isArray(body.respostas) ? body.respostas : [];

  // Limpa respostas anteriores deste fornecedor pra esta cotacao (re-submit substitui)
  await db
    .delete(schema.cotacaoRespostaItem)
    .where(eq(schema.cotacaoRespostaItem.cotacaoFornecedorId, cf.id));

  // Cria/acha marcas (texto livre por enquanto — vai criar marca nova se nao existir)
  async function acharOuCriarMarca(nome: string | null): Promise<string | null> {
    if (!nome || !nome.trim()) return null;
    const n = nome.trim();
    const existente = await db
      .select({ id: schema.marca.id })
      .from(schema.marca)
      .where(and(eq(schema.marca.filialId, cot.filialId), eq(schema.marca.nome, n)))
      .limit(1);
    if (existente[0]) return existente[0].id;
    const [novo] = await db
      .insert(schema.marca)
      .values({ filialId: cot.filialId, nome: n })
      .returning({ id: schema.marca.id });
    return novo.id;
  }

  if (respostas.length > 0) {
    for (const r of respostas) {
      const marcaId = await acharOuCriarMarca(r.marca);
      // fator_conversao default 1 (fornecedor cota direto na unidade do item).
      // Quando integrar com produto_fornecedor, podemos sugerir fator a partir do historico.
      const precoNum = Number(r.precoUnitario);
      await db.insert(schema.cotacaoRespostaItem).values({
        cotacaoFornecedorId: cf.id,
        cotacaoItemId: r.cotacaoItemId,
        marcaId,
        marcaTextoLivre: marcaId ? null : r.marca ?? null,
        precoUnitario: String(precoNum),
        precoUnitarioNormalizado: String(precoNum), // fator = 1 -> normalizado = unitario
        unidadeFornecedor: null, // fornecedor cotou direto na unidade do item
        fatorConversao: '1',
        observacao: r.observacao,
      });
    }
  }

  // Marca como RESPONDIDA
  await db
    .update(schema.cotacaoFornecedor)
    .set({
      status: 'RESPONDIDA',
      respondidoEm: new Date(),
    })
    .where(eq(schema.cotacaoFornecedor.id, cf.id));

  return NextResponse.json({ ok: true, count: respostas.length });
}
