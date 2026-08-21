// Revisao de items de NF sem produto interno linkado.
// Mostra cada item com top 3 sugestoes (jaccard de tokens) + opcao "nao e
// nenhum". Gestor clica e linka.

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { topSugestoes } from '@/lib/match-item-suggestions';
import { ReviewItemForm } from './review-form';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  page?: string;
}

const PAGE_SIZE = 30;

export default async function MatchItemsPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
   await exigirPerm(user.id, 'nota_compra.vincular_produto');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial = await escolherFilial(filiais, sp.filialId);
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
  const page = Math.max(0, Number(sp.page ?? '0') || 0);

  // Items orfaos da filial
  const itensOrfaos = await db
    .select({
      id: schema.notaCompraItem.id,
      descricao: schema.notaCompraItem.descricao,
      ean: schema.notaCompraItem.ean,
      codigoProdutoFornecedor: schema.notaCompraItem.codigoProdutoFornecedor,
      unidade: schema.notaCompraItem.unidade,
      quantidade: schema.notaCompraItem.quantidade,
      valorUnitario: schema.notaCompraItem.valorUnitario,
      ncm: schema.notaCompraItem.ncm,
      notaCompraId: schema.notaCompraItem.notaCompraId,
      notaNumero: schema.notaCompra.numero,
      dataEmissao: schema.notaCompra.dataEmissao,
      fornecedorNome: schema.fornecedor.nome,
    })
    .from(schema.notaCompraItem)
    .innerJoin(schema.notaCompra, eq(schema.notaCompra.id, schema.notaCompraItem.notaCompraId))
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.notaCompra.fornecedorId))
    .where(
      and(
        eq(schema.notaCompraItem.filialId, filial.id),
        isNull(schema.notaCompraItem.produtoId),
        isNotNull(schema.notaCompraItem.descricao),
      ),
    )
    .orderBy(desc(schema.notaCompra.dataEmissao))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  // Total pra mostrar progresso
  const [{ totalOrfaos }] = await db
    .select({ totalOrfaos: db.$count(schema.notaCompraItem) })
    .from(schema.notaCompraItem)
    .where(
      and(
        eq(schema.notaCompraItem.filialId, filial.id),
        isNull(schema.notaCompraItem.produtoId),
      ),
    );

  // Carrega produtos com categoria_compras pra calcular sugestoes
  const produtos = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      categoria: schema.produto.categoriaCompras,
      unidade: schema.produto.unidadeEstoque,
    })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filial.id),
        isNotNull(schema.produto.categoriaCompras),
        eq(schema.produto.controlaEstoque, true),
      ),
    )
    .orderBy(asc(schema.produto.nome));

  // Pra cada item, calcula top 3 sugestoes
  const itensComSugestoes = itensOrfaos.map((it) => ({
    ...it,
    sugestoes: topSugestoes(it.descricao, produtos, 3),
  }));

  const totalPaginas = Math.max(1, Math.ceil(Number(totalOrfaos) / PAGE_SIZE));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">
            Revisão de items sem produto
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {filial.nome} · {Number(totalOrfaos)} items de NF sem produto interno linkado.
            Confirme o produto certo ou diga &quot;nenhum desses&quot;.
          </p>
        </div>

        {filiais.length > 1 && (
          <div className="mb-4 flex gap-1 text-xs">
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/compras/match-items?filialId=${f.id}`}
                className={`rounded-md border px-2 py-1 ${
                  f.id === filial.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        {itensComSugestoes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm text-slate-500">
              ✓ Nenhum item órfão. Tudo linkado!
            </p>
          </div>
        ) : (
          <>
            <div className="mb-3 text-xs text-slate-500">
              Página {page + 1} de {totalPaginas} · mostrando {itensComSugestoes.length} items
            </div>
            <div className="space-y-3">
              {itensComSugestoes.map((it) => (
                <ReviewItemForm
                  key={it.id}
                  item={{
                    id: it.id,
                    descricao: it.descricao ?? '',
                    ean: it.ean,
                    codigoProdutoFornecedor: it.codigoProdutoFornecedor,
                    unidade: it.unidade,
                    quantidade: it.quantidade,
                    valorUnitario: it.valorUnitario,
                    ncm: it.ncm,
                    notaNumero: it.notaNumero,
                    dataEmissao: it.dataEmissao
                      ? new Date(it.dataEmissao).toLocaleDateString('pt-BR')
                      : null,
                    fornecedorNome: it.fornecedorNome,
                  }}
                  sugestoes={it.sugestoes}
                />
              ))}
            </div>

            {totalPaginas > 1 && (
              <div className="mt-4 flex items-center justify-between">
                {page > 0 ? (
                  <Link
                    href={`/compras/match-items?filialId=${filial.id}&page=${page - 1}`}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
                  >
                    ← Anterior
                  </Link>
                ) : (
                  <span />
                )}
                {page < totalPaginas - 1 ? (
                  <Link
                    href={`/compras/match-items?filialId=${filial.id}&page=${page + 1}`}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
                  >
                    Próxima →
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
