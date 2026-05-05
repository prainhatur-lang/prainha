// Tela de Reconciliação Produto x Fornecedor.
//
// Mostra: pra cada produto interno (com categoria_compras), todas as descrições
// já vistas em NFs de fornecedores diferentes (produto_fornecedor.descricao_fornecedor).
// Permite ver de onde vem cada descrição e (quando houver UI de edição) refazer o vinculo.
//
// Esta é a versão MVP: read-only. Edição inline será adicionada depois.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  q?: string;
  categoria?: string;
}

export default async function ReconciliacaoPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ?? filiais[0] ?? null;

  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const q = (sp.q ?? '').trim();
  const categoriaFiltro = (sp.categoria ?? '').trim();

  // Pega produtos com categoria_compras
  const produtos = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      tipo: schema.produto.tipo,
      categoria: schema.produto.categoriaCompras,
      unidade: schema.produto.unidadeEstoque,
    })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filial.id),
        isNotNull(schema.produto.categoriaCompras),
        eq(schema.produto.controlaEstoque, true),
        categoriaFiltro ? eq(schema.produto.categoriaCompras, categoriaFiltro) : undefined,
      ),
    )
    .orderBy(asc(schema.produto.categoriaCompras), asc(schema.produto.nome));

  // Pega marcas aceitas por produto
  const marcasRows = await db
    .select({
      produtoId: schema.produtoMarcaAceita.produtoId,
      marca: schema.marca.nome,
    })
    .from(schema.produtoMarcaAceita)
    .innerJoin(schema.marca, eq(schema.marca.id, schema.produtoMarcaAceita.marcaId))
    .where(eq(schema.produtoMarcaAceita.filialId, filial.id));
  const marcasPorProduto = new Map<string, string[]>();
  for (const r of marcasRows) {
    if (!marcasPorProduto.has(r.produtoId)) marcasPorProduto.set(r.produtoId, []);
    marcasPorProduto.get(r.produtoId)!.push(r.marca);
  }

  // Pega vinculos produto_fornecedor pra cada produto
  const vinculos = await db
    .select({
      produtoId: schema.produtoFornecedor.produtoId,
      fornecedorNome: schema.fornecedor.nome,
      codigoFornecedor: schema.produtoFornecedor.codigoFornecedor,
      ean: schema.produtoFornecedor.ean,
      descricaoFornecedor: schema.produtoFornecedor.descricaoFornecedor,
      unidadeFornecedor: schema.produtoFornecedor.unidadeFornecedor,
      fatorConversao: schema.produtoFornecedor.fatorConversao,
      ultimoPrecoCustoUnidade: schema.produtoFornecedor.ultimoPrecoCustoUnidade,
      ultimaCompraEm: schema.produtoFornecedor.ultimaCompraEm,
    })
    .from(schema.produtoFornecedor)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.produtoFornecedor.fornecedorId))
    .where(eq(schema.produtoFornecedor.filialId, filial.id));
  const vinculosPorProduto = new Map<string, typeof vinculos>();
  for (const v of vinculos) {
    if (!vinculosPorProduto.has(v.produtoId)) vinculosPorProduto.set(v.produtoId, []);
    vinculosPorProduto.get(v.produtoId)!.push(v);
  }

  // Filtro por busca
  const produtosFiltrados = q
    ? produtos.filter((p) =>
        (p.nome ?? '').toLowerCase().includes(q.toLowerCase()),
      )
    : produtos;

  const categorias = Array.from(new Set(produtos.map((p) => p.categoria))).filter(Boolean) as string[];

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">
            Reconciliação produto × fornecedor
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {filial.nome} · {produtosFiltrados.length} produtos · descrições e códigos vistos por
            fornecedor (alimentado a cada NF de entrada)
          </p>
        </div>

        {/* Filtros */}
        <form className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <input
            type="hidden"
            name="filialId"
            defaultValue={filial.id}
          />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar produto..."
            className="rounded border border-slate-200 px-2 py-1"
          />
          <select
            name="categoria"
            defaultValue={categoriaFiltro}
            className="rounded border border-slate-200 px-2 py-1"
          >
            <option value="">Todas categorias</option>
            {categorias.sort().map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-800"
          >
            Filtrar
          </button>
        </form>

        {produtosFiltrados.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm text-slate-500">
              Nenhum produto encontrado com filtro atual.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {produtosFiltrados.map((p) => {
              const marcas = marcasPorProduto.get(p.id) ?? [];
              const vincs = vinculosPorProduto.get(p.id) ?? [];
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="text-[10px] uppercase tracking-wide text-slate-500">
                        {p.categoria}
                      </span>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {p.nome}
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          [{p.tipo} / {p.unidade}]
                        </span>
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {marcas.length > 0 ? (
                        marcas.map((m) => (
                          <span
                            key={m}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700"
                          >
                            {m}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-slate-400">qualquer marca</span>
                      )}
                    </div>
                  </div>

                  {/* Vinculos com fornecedores */}
                  <div className="mt-3">
                    {vincs.length === 0 ? (
                      <p className="text-[11px] text-slate-400">
                        Nenhum vínculo com fornecedor ainda. Será preenchido automaticamente
                        quando uma NF de entrada chegar com este produto.
                      </p>
                    ) : (
                      <table className="w-full text-[11px]">
                        <thead className="text-slate-500">
                          <tr>
                            <th className="px-2 py-1 text-left font-medium">Fornecedor</th>
                            <th className="px-2 py-1 text-left font-medium">Descrição na NF</th>
                            <th className="px-2 py-1 text-left font-medium">Código / EAN</th>
                            <th className="px-2 py-1 text-right font-medium">Unid.fornec.</th>
                            <th className="px-2 py-1 text-right font-medium">Fator</th>
                            <th className="px-2 py-1 text-right font-medium">Último preço (un)</th>
                            <th className="px-2 py-1 text-left font-medium">Última compra</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vincs.map((v, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="px-2 py-1 font-medium text-slate-700">
                                {v.fornecedorNome}
                              </td>
                              <td className="px-2 py-1 text-slate-600">
                                {v.descricaoFornecedor ?? '—'}
                              </td>
                              <td className="px-2 py-1 text-slate-500">
                                {v.codigoFornecedor || v.ean || '—'}
                              </td>
                              <td className="px-2 py-1 text-right text-slate-500">
                                {v.unidadeFornecedor ?? '—'}
                              </td>
                              <td className="px-2 py-1 text-right text-slate-500">
                                {v.fatorConversao}
                              </td>
                              <td className="px-2 py-1 text-right text-slate-700">
                                {v.ultimoPrecoCustoUnidade
                                  ? brl(Number(v.ultimoPrecoCustoUnidade))
                                  : '—'}
                              </td>
                              <td className="px-2 py-1 text-slate-500">
                                {v.ultimaCompraEm
                                  ? new Date(v.ultimaCompraEm).toLocaleDateString('pt-BR')
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
