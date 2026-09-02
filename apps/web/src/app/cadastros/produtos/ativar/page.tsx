// Curadoria do cardápio da filial: clica no que vende aqui, o resto fica
// inativo. Feito pra Prainha Mar, que herdou o catálogo do Prainha Bar inteiro
// (1.376 produtos) e precisa escolher o que fica.
//
// A referência do lado ("vende no Prainha Bar") é o atalho: o dono disse que a
// maioria do que sai lá sai aqui, então dá pra ligar por categoria e só ajustar
// as exceções, em vez de decidir produto a produto no escuro.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { AtivarClient, type ProdutoLinha } from './ativar-client';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  tipo?: string;
}

export default async function AtivarProdutosPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'produto.update');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialResolvida = await escolherFilial(filiais, sp.filialId);
  if (!filialResolvida) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }
  const filial = filialResolvida;
  const tipo = sp.tipo === 'INSUMO' ? 'INSUMO' : 'VENDA_SIMPLES';

  const produtos = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      preco: schema.produto.precoVenda,
      etiqueta: schema.produto.codigoEtiqueta,
      descontinuado: schema.produto.descontinuado,
    })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filial.id),
        eq(schema.produto.tipo, tipo),
      ),
    )
    .orderBy(asc(schema.produto.nome));

  // Nome das categorias do cardápio (PRODUTOETIQUETA do Consumer).
  const etiquetas = await db
    .select({ codigo: schema.produtoEtiqueta.codigoExterno, nome: schema.produtoEtiqueta.nome })
    .from(schema.produtoEtiqueta)
    .where(eq(schema.produtoEtiqueta.filialId, filial.id));
  const nomeEtiqueta = new Map(etiquetas.map((e) => [String(e.codigo), e.nome]));

  // Referência: o que as filiais irmãs vendem (por nome, que é o que casa
  // entre catálogos diferentes). Vira o "lá também tem" da tela.
  const irmas = filiais.filter((f) => f.id !== filial.id).map((f) => f.id);
  const vendeNaIrma = new Set<string>();
  if (irmas.length > 0) {
    const rows = await db
      .select({ nome: sql<string>`lower(trim(${schema.produto.nome}))` })
      .from(schema.produto)
      .where(
        and(
          inArray(schema.produto.filialId, irmas),
          eq(schema.produto.tipo, tipo),
          sql`COALESCE(${schema.produto.descontinuado}, false) = false`,
        ),
      );
    for (const r of rows) vendeNaIrma.add(r.nome);
  }

  // Já vendeu aqui nos últimos 90 dias = prova de que o produto é usado.
  const jaVendeu = new Set<string>();
  const vendas = await db
    .select({ produtoId: schema.produto.id })
    .from(schema.pedidoItem)
    .innerJoin(schema.pedido, eq(schema.pedido.id, schema.pedidoItem.pedidoId))
    .innerJoin(
      schema.produto,
      and(
        eq(schema.produto.filialId, filial.id),
        eq(schema.produto.codigoExterno, schema.pedidoItem.codigoProdutoExterno),
      ),
    )
    .where(
      and(
        eq(schema.pedidoItem.filialId, filial.id),
        sql`${schema.pedido.dataFechamento} >= now() - interval '90 days'`,
      ),
    )
    .groupBy(schema.produto.id);
  for (const v of vendas) jaVendeu.add(v.produtoId);

  const linhas: ProdutoLinha[] = produtos.map((p) => ({
    id: p.id,
    nome: p.nome ?? '(sem nome)',
    preco: p.preco != null ? Number(p.preco) : null,
    categoria: p.etiqueta ? (nomeEtiqueta.get(String(p.etiqueta)) ?? `Categoria ${p.etiqueta}`) : 'Sem categoria',
    ativo: !p.descontinuado,
    naIrma: vendeNaIrma.has((p.nome ?? '').toLowerCase().trim()),
    jaVendeu: jaVendeu.has(p.id),
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">O que esta loja vende</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Clique pra ligar ou desligar. O que ficar desligado sai do PDV do garçom desta loja
            (a loja aplica em ~1 min) — as outras lojas não mudam.
          </p>
        </div>

        {/* ⚠️ QUAL LOJA — em 02/09/2026 o dono curou o cardápio achando que
            estava na Prainha Mar e desativou 70 produtos na Prainha Bar: o nome
            da filial era uma linha cinza de 12px. Agora é um banner, e a troca
            de loja está AQUI, sem depender do seletor do menu. */}
        <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
            Você está editando o cardápio de
          </p>
          <p className="mt-0.5 text-2xl font-bold text-amber-900">{filial.nome}</p>
          {filiais.length > 1 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-amber-800">Trocar de loja:</span>
              {filiais.map((f) => (
                <a
                  key={f.id}
                  href={`/cadastros/produtos/ativar?filialId=${f.id}&tipo=${tipo}`}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                    f.id === filial.id
                      ? 'border-amber-700 bg-amber-700 text-white'
                      : 'border-amber-300 bg-white text-amber-900 hover:bg-amber-100'
                  }`}
                >
                  {f.nome}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="mb-4 flex gap-2 text-xs">
          <a
            href={`/cadastros/produtos/ativar?filialId=${filial.id}&tipo=VENDA_SIMPLES`}
            className={`rounded-md border px-3 py-1.5 ${
              tipo === 'VENDA_SIMPLES'
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Produtos de venda
          </a>
          <a
            href={`/cadastros/produtos/ativar?filialId=${filial.id}&tipo=INSUMO`}
            className={`rounded-md border px-3 py-1.5 ${
              tipo === 'INSUMO'
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Insumos
          </a>
        </div>

        <AtivarClient filialId={filial.id} filialNome={filial.nome} linhas={linhas} />
      </div>
    </main>
  );
}
