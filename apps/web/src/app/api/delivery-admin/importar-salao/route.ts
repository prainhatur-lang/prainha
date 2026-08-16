// GET  /api/delivery-admin/importar-salao?filialId=&origem= — TODOS os produtos
//      do salão (espelho do Consumer) numa lista só, com preço e saldo real de
//      estoque, pra marcar no checkbox o que entra no delivery.
//      `origem` permite puxar o catálogo de OUTRA filial da organização (loja
//      nova que ainda não tem PDV sincronizado copia o cardápio da irmã).
//      Também devolve as filiais disponíveis com a contagem de produtos.
// POST — cria os itens escolhidos. Aceita categoria existente (categoriaId)
//      OU nome de categoria nova (categoriaNova), criada na hora — assim dá
//      pra trazer produto sem ter categoria montada antes.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { limparNomeProduto, normalizarNome } from '@/lib/orcamentos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PRODUTOTIPO do Consumer. A casa só vende estes dois no cardápio.
const TIPO_PRODUTO = 1;
const TIPO_PRODUTO_POR_TAMANHO = 5;

/** O cardápio do Terraço vive no Consumer como cópia com prefixo "T " e preço
 *  próprio (394 das 974 variantes da Prainha Bar). O delivery NÃO usa essa
 *  lista — decisão do dono — então ela fica fora da janela de produtos. Sem
 *  esse corte a lista ainda mostraria duas linhas iguais com preços
 *  diferentes, já que limparNomeProduto remove o prefixo. */
function ehDoTerraco(nomeCru: string | null | undefined): boolean {
  return /^T\s+/.test((nomeCru ?? '').replace(/^[.*\s]+/, ''));
}

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('delivery.read');
  if (error) return error;

  const url = new URL(request.url);
  const filialId = url.searchParams.get('filialId') ?? '';
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ itens: [], categorias: [], filiaisOrigem: [] });
  }

  // De qual filial vêm os produtos. Default: a própria. Só filial acessível.
  const origemParam = url.searchParams.get('origem') ?? '';
  const origemId = filiais.some((f) => f.id === origemParam) ? origemParam : filialId;

  const rows = await db
    .select({
      varianteId: schema.produtoVariante.id,
      nome: schema.produto.nome,
      descricao: schema.produto.descricao,
      preco: schema.produtoVariante.precoVenda,
      precoProduto: schema.produto.precoVenda,
      estoqueControlado: schema.produtoVariante.estoqueControlado,
      estoqueAtual: schema.produtoVariante.estoqueAtual,
      codigoCozinha: schema.produto.codigoCozinha,
      tipo: schema.produto.codigoProdutoTipo,
      tamanho: schema.produtoTamanho.descricao,
      categoria: schema.produtoEtiqueta.nome,
    })
    .from(schema.produtoVariante)
    .innerJoin(
      schema.produto,
      and(
        eq(schema.produto.filialId, schema.produtoVariante.filialId),
        eq(schema.produto.codigoExterno, schema.produtoVariante.codigoProdutoExterno),
      ),
    )
    .leftJoin(
      schema.produtoTamanho,
      eq(schema.produtoTamanho.id, schema.produtoVariante.produtoTamanhoId),
    )
    // Categoria real do cardápio (ETIQUETAS do Consumer). codigo_etiqueta é
    // varchar no espelho, então o join precisa do cast.
    .leftJoin(
      schema.produtoEtiqueta,
      and(
        eq(schema.produtoEtiqueta.filialId, schema.produto.filialId),
        sql`${schema.produtoEtiqueta.codigoExterno} = NULLIF(regexp_replace(${schema.produto.codigoEtiqueta}, '\\D', '', 'g'), '')::integer`,
      ),
    )
    .where(
      and(
        eq(schema.produtoVariante.filialId, origemId),
        isNull(schema.produtoVariante.dataPausado),
        isNull(schema.produtoVariante.dataDelete),
        or(eq(schema.produto.descontinuado, false), isNull(schema.produto.descontinuado)),
        // A casa só vende PRODUTO (1) e PRODUTO POR TAMANHO (5). Insumo,
        // complemento, combo e serviço não são itens de cardápio.
        inArray(schema.produto.codigoProdutoTipo, [TIPO_PRODUTO, TIPO_PRODUTO_POR_TAMANHO]),
      ),
    );

  // Cada TAMANHO é um item de venda próprio, com preço próprio: "Absolut"
  // existe como Dose (R$22) e Garrafa (R$250), e "Cachaça" tem 17 sabores de
  // R$20 a R$27. Por isso o tamanho entra no NOME e na chave de dedupe —
  // colapsar por nome puro escolheria um preço arbitrário e poderia vender a
  // garrafa pelo preço da dose.
  //
  // Dedupe só junta o que é duplicata de verdade: mesmo nome, mesmo tamanho
  // E mesmo preço (o Consumer tem linhas repetidas assim).
  const porChave = new Map<
    string,
    {
      varianteId: string;
      nome: string;
      descricao: string | null;
      precoCentavos: number;
      tamanho: string | null;
      categoria: string | null;
      estoqueControlado: boolean;
      estoqueAtual: number | null;
      codigoCozinha: number | null;
    }
  >();
  for (const r of rows) {
    // Terraço sai por nome E por categoria: 8 produtos ("Terraco Prainha" e
    // "Terraco Bebidas") não têm o prefixo "T " e escapavam do filtro de nome.
    if (ehDoTerraco(r.nome) || /terra[çc]o/i.test(r.categoria ?? '')) continue;
    const limpo = limparNomeProduto(r.nome);
    if (!limpo) continue;
    const precoNum = Number(r.preco ?? r.precoProduto ?? 0);
    if (!Number.isFinite(precoNum) || precoNum <= 0) continue;
    const precoCentavos = Math.round(precoNum * 100);
    const tamanho = (r.tamanho ?? '').trim() || null;
    const nomeCompleto = tamanho ? `${limpo} — ${tamanho}` : limpo;
    const chave = `${normalizarNome(nomeCompleto)}|${precoCentavos}`;
    const controlado = r.estoqueControlado === true;
    const cand = {
      varianteId: r.varianteId,
      nome: nomeCompleto,
      descricao: (r.descricao ?? '').trim() || null,
      precoCentavos,
      tamanho,
      categoria: (r.categoria ?? '').trim() || null,
      estoqueControlado: controlado,
      estoqueAtual: controlado && r.estoqueAtual != null ? Number(r.estoqueAtual) : null,
      codigoCozinha: r.codigoCozinha ?? null,
    };
    const atual = porChave.get(chave);
    if (!atual || (!atual.descricao && cand.descricao)) porChave.set(chave, cand);
  }

  // O que já está no cardápio do delivery (por vínculo e por nome).
  const jaTem = await db
    .select({ nome: schema.deliveryItem.nome, varianteId: schema.deliveryItem.varianteId })
    .from(schema.deliveryItem)
    .where(eq(schema.deliveryItem.filialId, filialId));
  const nomesExistentes = new Set(jaTem.map((i) => normalizarNome(i.nome)));
  const variantesExistentes = new Set(jaTem.map((i) => i.varianteId).filter(Boolean));

  const itens = [...porChave.entries()]
    .map(([chave, v]) => ({
      ...v,
      jaNoCardapio: nomesExistentes.has(chave) || variantesExistentes.has(v.varianteId),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  // Categorias pro seletor de destino da janela.
  const categorias = await db
    .select({ id: schema.deliveryCategoria.id, nome: schema.deliveryCategoria.nome })
    .from(schema.deliveryCategoria)
    .where(eq(schema.deliveryCategoria.filialId, filialId))
    .orderBy(asc(schema.deliveryCategoria.ordem), asc(schema.deliveryCategoria.nome));

  // Quantos produtos cada filial acessível tem — mostra na hora de escolher a
  // origem que "Prainha Mar (0)" está sem PDV sincronizado.
  const contagens = await db
    .select({
      filialId: schema.produtoVariante.filialId,
      total: sql<number>`count(*)::int`,
    })
    .from(schema.produtoVariante)
    .innerJoin(
      schema.produto,
      and(
        eq(schema.produto.filialId, schema.produtoVariante.filialId),
        eq(schema.produto.codigoExterno, schema.produtoVariante.codigoProdutoExterno),
      ),
    )
    .where(
      and(
        inArray(
          schema.produtoVariante.filialId,
          filiais.map((f) => f.id),
        ),
        isNull(schema.produtoVariante.dataPausado),
        isNull(schema.produtoVariante.dataDelete),
        or(eq(schema.produto.descontinuado, false), isNull(schema.produto.descontinuado)),
        // Mesmo recorte da lista, senão o seletor promete produto que não vem.
        inArray(schema.produto.codigoProdutoTipo, [TIPO_PRODUTO, TIPO_PRODUTO_POR_TAMANHO]),
        sql`regexp_replace(${schema.produto.nome}, '^[.*[:space:]]+', '') !~ '^T[[:space:]]'`,
      ),
    )
    .groupBy(schema.produtoVariante.filialId);
  const porFilial = new Map(contagens.map((c) => [c.filialId, c.total]));

  return NextResponse.json({
    itens,
    categorias,
    origemId,
    filiaisOrigem: filiais.map((f) => ({
      id: f.id,
      nome: f.nome,
      produtos: porFilial.get(f.id) ?? 0,
    })),
  });
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('delivery.create');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  const itens = Array.isArray(b?.itens) ? b.itens : [];
  const categoriaNova =
    typeof b?.categoriaNova === 'string' && b.categoriaNova.trim()
      ? b.categoriaNova.trim().slice(0, 80)
      : null;
  let categoriaId = typeof b?.categoriaId === 'string' ? b.categoriaId : null;

  // Quando true, cada item vai pra uma categoria com o nome da categoria dele
  // no cardápio do salão — preserva a estrutura em vez de jogar tudo num balde.
  const manterCategorias = b?.manterCategorias === true;

  if (!filialId || itens.length === 0 || (!categoriaId && !categoriaNova && !manterCategorias)) {
    return NextResponse.json(
      { error: 'filial, categoria (existente ou nova) e itens são obrigatórios' },
      { status: 400 },
    );
  }
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  // Produto copiado de OUTRA filial entra sem vínculo com a variante: o preço
  // e o estoque da loja irmã não valem aqui. Vira item independente, que é o
  // certo pra loja nova que ainda não tem PDV próprio sincronizado.
  const origemId = typeof b?.origemFilialId === 'string' ? b.origemFilialId : filialId;
  const manterVinculo = origemId === filialId;

  // Resolve uma categoria pelo NOME: reusa a existente ou cria — evita
  // duplicar "Bebidas" toda vez que o usuário importa de novo.
  const cacheCategorias = new Map<string, string>();
  async function categoriaPorNome(nome: string): Promise<string> {
    const chave = nome.trim().toLowerCase();
    const emCache = cacheCategorias.get(chave);
    if (emCache) return emCache;
    const [existente] = await db
      .select({ id: schema.deliveryCategoria.id })
      .from(schema.deliveryCategoria)
      .where(
        and(
          eq(schema.deliveryCategoria.filialId, filialId!),
          sql`lower(${schema.deliveryCategoria.nome}) = ${chave}`,
        ),
      )
      .limit(1);
    if (existente) {
      cacheCategorias.set(chave, existente.id);
      return existente.id;
    }
    const todas = await db
      .select({ ordem: schema.deliveryCategoria.ordem })
      .from(schema.deliveryCategoria)
      .where(eq(schema.deliveryCategoria.filialId, filialId!));
    const proxima = todas.reduce((m, c) => Math.max(m, c.ordem), 0) + 1;
    const [nova] = await db
      .insert(schema.deliveryCategoria)
      .values({ filialId: filialId!, nome: nome.trim().slice(0, 80), ordem: proxima })
      .returning({ id: schema.deliveryCategoria.id });
    cacheCategorias.set(chave, nova.id);
    return nova.id;
  }

  if (!categoriaId && categoriaNova) categoriaId = await categoriaPorNome(categoriaNova);

  type LinhaItem = {
    filialId: string;
    categoriaId: string;
    nome: string;
    descricao: string | null;
    preco: string;
    varianteId: string | null;
  };

  // Com manterCategorias, cada item resolve a própria categoria pelo nome que
  // veio do cardápio; sem categoria no salão, cai em "Outros".
  const categoriaDoItem = new Map<string, string>();
  if (manterCategorias) {
    const nomes = new Set(
      (itens as Array<{ categoria?: unknown }>).map((i) =>
        typeof i?.categoria === 'string' && i.categoria.trim() ? i.categoria.trim() : 'Outros',
      ),
    );
    for (const n of nomes) categoriaDoItem.set(n, await categoriaPorNome(n));
  }

  const linhas: LinhaItem[] = (itens as unknown[])
    .map((i: unknown): LinhaItem | null => {
      const o = i as {
        nome?: unknown;
        descricao?: unknown;
        preco?: unknown;
        varianteId?: unknown;
        categoria?: unknown;
      };
      const nome = typeof o?.nome === 'string' ? o.nome.trim().slice(0, 160) : '';
      const preco = Number(o?.preco);
      if (!nome || !Number.isFinite(preco) || preco <= 0) return null;
      const destino = manterCategorias
        ? categoriaDoItem.get(
            typeof o?.categoria === 'string' && o.categoria.trim() ? o.categoria.trim() : 'Outros',
          )
        : categoriaId;
      if (!destino) return null;
      return {
        filialId,
        categoriaId: destino,
        nome,
        descricao:
          typeof o?.descricao === 'string' && o.descricao.trim()
            ? o.descricao.trim().slice(0, 600)
            : null,
        preco: preco.toFixed(2),
        varianteId:
          manterVinculo && typeof o?.varianteId === 'string' ? o.varianteId : null,
      };
    })
    .filter((l): l is LinhaItem => l != null)
    .slice(0, 300);

  if (linhas.length === 0) {
    return NextResponse.json({ error: 'nenhum item válido' }, { status: 400 });
  }

  await db.insert(schema.deliveryItem).values(linhas);
  return NextResponse.json({
    ok: true,
    criados: linhas.length,
    categoriaId,
    categorias: manterCategorias ? cacheCategorias.size : 1,
  });
}
