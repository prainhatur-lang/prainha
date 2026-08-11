// GET  /api/delivery-admin/importar-salao?filialId= — TODOS os produtos do
//      salão (espelho do Consumer) numa lista só, com preço do salão e o
//      saldo real de estoque, pra marcar no checkbox o que entra no delivery.
// POST — cria os itens escolhidos. Aceita categoria existente (categoriaId)
//      OU nome de categoria nova (categoriaNova), criada na hora — assim dá
//      pra trazer produto sem ter categoria montada antes.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { limparNomeProduto, normalizarNome } from '@/lib/orcamentos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('delivery.read');
  if (error) return error;

  const filialId = new URL(request.url).searchParams.get('filialId') ?? '';
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ itens: [], categorias: [] });
  }

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
        eq(schema.produtoVariante.filialId, filialId),
        isNull(schema.produtoVariante.dataPausado),
        isNull(schema.produtoVariante.dataDelete),
        or(eq(schema.produto.descontinuado, false), isNull(schema.produto.descontinuado)),
      ),
    );

  // Dedupe por nome normalizado; entre variantes iguais fica a que tem
  // descrição (a descrição vem do Consumer e serve de texto do cardápio).
  const porChave = new Map<
    string,
    {
      varianteId: string;
      nome: string;
      descricao: string | null;
      precoCentavos: number;
      estoqueControlado: boolean;
      estoqueAtual: number | null;
      codigoCozinha: number | null;
    }
  >();
  for (const r of rows) {
    const limpo = limparNomeProduto(r.nome);
    if (!limpo) continue;
    const precoNum = Number(r.preco ?? r.precoProduto ?? 0);
    if (!Number.isFinite(precoNum) || precoNum <= 0) continue;
    const chave = normalizarNome(limpo);
    const controlado = r.estoqueControlado === true;
    const cand = {
      varianteId: r.varianteId,
      nome: limpo,
      descricao: (r.descricao ?? '').trim() || null,
      precoCentavos: Math.round(precoNum * 100),
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

  return NextResponse.json({ itens, categorias });
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

  if (!filialId || itens.length === 0 || (!categoriaId && !categoriaNova)) {
    return NextResponse.json(
      { error: 'filial, categoria (existente ou nova) e itens são obrigatórios' },
      { status: 400 },
    );
  }
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  // Categoria nova: reusa se já existir uma com o mesmo nome (evita duplicar
  // "Bebidas" toda vez que o usuário importa de novo).
  if (!categoriaId && categoriaNova) {
    const [existente] = await db
      .select({ id: schema.deliveryCategoria.id })
      .from(schema.deliveryCategoria)
      .where(
        and(
          eq(schema.deliveryCategoria.filialId, filialId),
          eq(schema.deliveryCategoria.nome, categoriaNova),
        ),
      )
      .limit(1);
    if (existente) {
      categoriaId = existente.id;
    } else {
      const todas = await db
        .select({ ordem: schema.deliveryCategoria.ordem })
        .from(schema.deliveryCategoria)
        .where(eq(schema.deliveryCategoria.filialId, filialId));
      const proxima = todas.reduce((m, c) => Math.max(m, c.ordem), 0) + 1;
      const [nova] = await db
        .insert(schema.deliveryCategoria)
        .values({ filialId, nome: categoriaNova, ordem: proxima })
        .returning({ id: schema.deliveryCategoria.id });
      categoriaId = nova.id;
    }
  }

  type LinhaItem = {
    filialId: string;
    categoriaId: string;
    nome: string;
    descricao: string | null;
    preco: string;
    varianteId: string | null;
  };

  const linhas: LinhaItem[] = (itens as unknown[])
    .map((i: unknown): LinhaItem | null => {
      const o = i as { nome?: unknown; descricao?: unknown; preco?: unknown; varianteId?: unknown };
      const nome = typeof o?.nome === 'string' ? o.nome.trim().slice(0, 160) : '';
      const preco = Number(o?.preco);
      if (!nome || !Number.isFinite(preco) || preco <= 0) return null;
      return {
        filialId,
        categoriaId: categoriaId!,
        nome,
        descricao:
          typeof o?.descricao === 'string' && o.descricao.trim()
            ? o.descricao.trim().slice(0, 600)
            : null,
        preco: preco.toFixed(2),
        varianteId: typeof o?.varianteId === 'string' ? o.varianteId : null,
      };
    })
    .filter((l): l is LinhaItem => l != null)
    .slice(0, 300);

  if (linhas.length === 0) {
    return NextResponse.json({ error: 'nenhum item válido' }, { status: 400 });
  }

  await db.insert(schema.deliveryItem).values(linhas);
  return NextResponse.json({ ok: true, criados: linhas.length, categoriaId });
}
