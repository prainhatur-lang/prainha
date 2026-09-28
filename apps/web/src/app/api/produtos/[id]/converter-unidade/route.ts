// POST /api/produtos/[id]/converter-unidade — { para: 'ml'|'g'|..., fator }
//
// Troca a unidade de estoque de um insumo CONVERTENDO tudo que está nela:
// garrafa (un) → ml com fator 1000 (garrafa de 1L). Compra continua entrando
// em garrafa/galão/peça — o fator do fornecedor e as embalagens passam a
// dizer quantos ml cada uma gera — e a ficha pede a dose em ml.
//
// Numa transação:
//  - produto: saldo, mínimo e máximo × fator; custo ÷ fator; a unidade antiga
//    vira embalagem ("garrafa" = 1000 ml) e volume_unitario_ml = fator.
//  - movimento_estoque: qtd × fator, preço unit ÷ fator (valor não muda) —
//    o histórico continua batendo com o saldo.
//  - ficha_tecnica que usa o insumo: linha na unidade antiga (ou sem unidade)
//    vira ml. As fichas vieram do Consumer, que anotava a dose em LITRO
//    (0,06 = 60 ml em qualquer garrafa; 0,75 numa de 750 = garrafa inteira),
//    então un→ml lê a quantidade como litro, e 1 (ou ~o volume) = a garrafa.
//    fichaEm='embalagem' multiplica pelo fator (0,5 garrafa = 375 ml).
//    Linha já em outra unidade fica como está.
//  - produto_fornecedor: fator × fator; preço por unidade ÷ fator.
//  - produto_embalagem: qtd × fator.
//  - OP / template de OP: quantidades × fator.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  para: z.enum(['un', 'ml', 'g', 'kg', 'l']),
  fator: z.number().positive().max(1_000_000),
  /** Nome da embalagem antiga ("garrafa", "galão", "peça"). */
  embalagem: z.string().trim().min(1).max(40).optional(),
  /** Como ler a ficha em un: 'litro' (padrão do Consumer) ou fração da embalagem. */
  fichaEm: z.enum(['litro', 'embalagem']).default('litro'),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'produto.update');
  if (semPerm) return semPerm;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  const { para, fator } = parsed.data;

  const [prod] = await db
    .select({
      id: schema.produto.id,
      filialId: schema.produto.filialId,
      unidade: schema.produto.unidadeEstoque,
    })
    .from(schema.produto)
    .where(eq(schema.produto.id, id))
    .limit(1);
  if (!prod) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, prod.filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const de = (prod.unidade ?? 'un').toLowerCase();
  if (de === para) return NextResponse.json({ error: `já está em ${para}` }, { status: 400 });
  const f = fator.toString();
  const embalagem = parsed.data.embalagem ?? (de === 'un' ? 'garrafa' : de);
  const q = schema.fichaTecnica.quantidade;
  const novaQtdFicha =
    de === 'un' && para === 'ml' && parsed.data.fichaEm === 'litro'
      ? sql`CASE WHEN ${q} = 1 OR (${q} >= 0.5 AND abs(${q} * 1000 - ${f}::numeric) <= ${f}::numeric * 0.1)
              THEN ${f}::numeric ELSE ${q} * 1000 END`
      : sql`${q} * ${f}::numeric`;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.produto)
      .set({
        unidadeEstoque: para,
        estoqueAtual: sql`${schema.produto.estoqueAtual} * ${f}::numeric`,
        estoqueMinimo: sql`${schema.produto.estoqueMinimo} * ${f}::numeric`,
        estoqueMaximo: sql`${schema.produto.estoqueMaximo} * ${f}::numeric`,
        precoCusto: sql`${schema.produto.precoCusto} / ${f}::numeric`,
        ...(de === 'un' && para === 'ml' ? { volumeUnitarioMl: f } : {}),
      })
      .where(eq(schema.produto.id, id));

    await tx
      .update(schema.movimentoEstoque)
      .set({
        quantidade: sql`${schema.movimentoEstoque.quantidade} * ${f}::numeric`,
        precoUnitario: sql`${schema.movimentoEstoque.precoUnitario} / ${f}::numeric`,
      })
      .where(eq(schema.movimentoEstoque.produtoId, id));

    await tx
      .update(schema.fichaTecnica)
      .set({
        quantidade: novaQtdFicha,
        unidade: para,
      })
      .where(
        and(
          eq(schema.fichaTecnica.insumoId, id),
          sql`(${schema.fichaTecnica.unidade} IS NULL OR lower(${schema.fichaTecnica.unidade}) = ${de})`,
        ),
      );

    await tx
      .update(schema.produtoFornecedor)
      .set({
        fatorConversao: sql`${schema.produtoFornecedor.fatorConversao} * ${f}::numeric`,
        ultimoPrecoCustoUnidade: sql`${schema.produtoFornecedor.ultimoPrecoCustoUnidade} / ${f}::numeric`,
      })
      .where(eq(schema.produtoFornecedor.produtoId, id));

    await tx
      .update(schema.produtoEmbalagem)
      .set({ qtdNaUnidadeEstoque: sql`${schema.produtoEmbalagem.qtdNaUnidadeEstoque} * ${f}::numeric` })
      .where(eq(schema.produtoEmbalagem.produtoId, id));
    // A unidade antiga vira embalagem padrão: "garrafa = 1000 ml".
    const [temPadrao] = await tx
      .select({ id: schema.produtoEmbalagem.id })
      .from(schema.produtoEmbalagem)
      .where(and(eq(schema.produtoEmbalagem.produtoId, id), eq(schema.produtoEmbalagem.padrao, true)))
      .limit(1);
    await tx
      .insert(schema.produtoEmbalagem)
      .values({
        filialId: prod.filialId,
        produtoId: id,
        nome: embalagem,
        qtdNaUnidadeEstoque: f,
        padrao: !temPadrao,
        fonte: 'DONO',
      })
      .onConflictDoUpdate({
        target: [schema.produtoEmbalagem.produtoId, schema.produtoEmbalagem.nome],
        set: { qtdNaUnidadeEstoque: f },
      });

    await tx
      .update(schema.ordemProducaoEntrada)
      .set({ quantidade: sql`${schema.ordemProducaoEntrada.quantidade} * ${f}::numeric` })
      .where(eq(schema.ordemProducaoEntrada.produtoId, id));
    await tx
      .update(schema.ordemProducaoSaida)
      .set({ quantidade: sql`${schema.ordemProducaoSaida.quantidade} * ${f}::numeric` })
      .where(eq(schema.ordemProducaoSaida.produtoId, id));
    await tx
      .update(schema.templateOpEntrada)
      .set({ quantidadePadrao: sql`${schema.templateOpEntrada.quantidadePadrao} * ${f}::numeric` })
      .where(eq(schema.templateOpEntrada.produtoId, id));
    await tx
      .update(schema.templateOpSaida)
      .set({ quantidadePadrao: sql`${schema.templateOpSaida.quantidadePadrao} * ${f}::numeric` })
      .where(eq(schema.templateOpSaida.produtoId, id));
  });

  return NextResponse.json({ id, ok: true, de, para, fator });
}
