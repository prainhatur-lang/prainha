// CRIAR PRODUTO DE VENDA no nosso banco (sem Consumer).
//
// Até aqui só dava pra criar INSUMO, que vive só na nuvem e não vende. Produto
// de venda nascia no Consumer — que sai do ar na 0001. Agora nasce aqui e a
// loja recebe pelo pull do catálogo (/api/loja/catalogo-nuvem).
//
// CÓDIGOS SINTÉTICOS: o PDV inteiro é chaveado por número (PRODUTOS.CODIGO e
// PRODUTODETALHE.CODIGO). Produto nosso não tem esses números, então recebe um
// da faixa 900000+ — o Consumer está na casa dos 2.000 e cresce de um em um,
// não chega lá nunca. Assim o produto convive com o catálogo do Firebird sem
// colidir, e continua válido depois do desligamento.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { db, schema } from '@concilia/db';
import { and, eq, gte, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Faixa reservada pro que nasce na nuvem. */
const BASE_SINTETICA = 900000;

const Tamanho = z.object({
  descricao: z.string().max(40).trim().optional(),
  precoVenda: z.number().positive().max(100000),
  comandaMobile: z.boolean().default(true),
  cardapioDigital: z.boolean().default(true),
});

const Body = z.object({
  filialId: z.string().uuid(),
  nome: z.string().min(2).max(200).trim(),
  descricao: z.string().max(200).trim().optional(),
  codigoEtiqueta: z.number().int().positive().optional(),
  codigoCozinha: z.number().int().positive().optional(),
  unidadeEstoque: z.enum(['un', 'ml', 'g', 'kg', 'l']).default('un'),
  controlaEstoque: z.boolean().default(false),
  tamanhos: z.array(Tamanho).min(1).max(20),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'produto.create');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'dados inválidos' }, { status: 400 });
  }
  const b = parsed.data;

  const [link] = await db
    .select({ x: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, b.filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso a essa filial' }, { status: 403 });

  // Categoria e praça precisam existir — código solto tira o produto do
  // cardápio sem ninguém entender por quê (mesmo cuidado da fila de alteração).
  if (b.codigoEtiqueta != null) {
    const [e] = await db
      .select({ x: schema.produtoEtiqueta.codigoExterno })
      .from(schema.produtoEtiqueta)
      .where(and(eq(schema.produtoEtiqueta.filialId, b.filialId), eq(schema.produtoEtiqueta.codigoExterno, b.codigoEtiqueta)))
      .limit(1);
    if (!e) return NextResponse.json({ error: 'categoria não existe nesta filial' }, { status: 400 });
  }
  if (b.codigoCozinha != null) {
    const [c] = await db
      .select({ x: schema.areaProducao.codigoExterno })
      .from(schema.areaProducao)
      .where(and(eq(schema.areaProducao.filialId, b.filialId), eq(schema.areaProducao.codigoExterno, b.codigoCozinha)))
      .limit(1);
    if (!c) return NextResponse.json({ error: 'praça não existe nesta filial' }, { status: 400 });
  }

  const criado = await db.transaction(async (tx) => {
    // Próximo código sintético: olha só a faixa 900000+ da filial.
    const [maxP] = await tx
      .select({ m: sql<number>`COALESCE(MAX(${schema.produto.codigoExterno}), ${BASE_SINTETICA - 1})` })
      .from(schema.produto)
      .where(and(eq(schema.produto.filialId, b.filialId), gte(schema.produto.codigoExterno, BASE_SINTETICA)));
    const codigoProduto = Number(maxP.m) + 1;

    const [prod] = await tx
      .insert(schema.produto)
      .values({
        filialId: b.filialId,
        codigoExterno: codigoProduto,
        nome: b.nome,
        descricao: b.descricao ?? null,
        codigoEtiqueta: b.codigoEtiqueta != null ? String(b.codigoEtiqueta) : null,
        codigoCozinha: b.codigoCozinha ?? null,
        precoVenda: b.tamanhos[0].precoVenda.toFixed(4),
        tipo: 'VENDA_SIMPLES',
        unidadeEstoque: b.unidadeEstoque,
        controlaEstoque: b.controlaEstoque,
        estoqueControlado: b.controlaEstoque,
        criadoNaNuvem: true,
        descontinuado: false,
      })
      .returning({ id: schema.produto.id });

    const [maxV] = await tx
      .select({ m: sql<number>`COALESCE(MAX(${schema.produtoVariante.codigoExterno}), ${BASE_SINTETICA - 1})` })
      .from(schema.produtoVariante)
      .where(and(eq(schema.produtoVariante.filialId, b.filialId), gte(schema.produtoVariante.codigoExterno, BASE_SINTETICA)));
    let proximo = Number(maxV.m) + 1;

    const variantes = [];
    for (const t of b.tamanhos) {
      const [v] = await tx
        .insert(schema.produtoVariante)
        .values({
          filialId: b.filialId,
          codigoExterno: proximo++,
          codigoProdutoExterno: codigoProduto,
          produtoId: prod.id,
          precoVenda: t.precoVenda.toFixed(4),
          comandaMobile: t.comandaMobile,
          cardapioDigital: t.cardapioDigital,
          desktop: true,
        })
        .returning({ id: schema.produtoVariante.id, codigo: schema.produtoVariante.codigoExterno });
      variantes.push({ ...v, descricao: t.descricao ?? null });
    }

    // O nome do tamanho ("Dose", "Garrafa") mora em PRODUTOTAMANHO no Consumer.
    // Aqui guardo junto da variante via produto_tamanho próprio quando informado.
    for (const v of variantes) {
      if (!v.descricao) continue;
      const [pt] = await tx
        .insert(schema.produtoTamanho)
        .values({
          filialId: b.filialId,
          codigoExterno: v.codigo,
          descricao: v.descricao,
          sigla: v.descricao.slice(0, 10),
        })
        .returning({ id: schema.produtoTamanho.id });
      await tx
        .update(schema.produtoVariante)
        .set({ produtoTamanhoId: pt.id, codigoProdutoTamanhoExterno: v.codigo })
        .where(eq(schema.produtoVariante.id, v.id));
    }

    return { id: prod.id, codigoProduto, tamanhos: variantes.length };
  });

  return NextResponse.json({ ok: true, ...criado }, { status: 201 });
}
