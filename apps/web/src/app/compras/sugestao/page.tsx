// Sugestão de compra: lista produtos no/abaixo do estoque mínimo, mostra o
// consumo da última semana e sugere quanto pedir (repor até o máximo).
// Daí o usuário seleciona, ajusta e gera uma cotação (fluxo existente).

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { SugestaoClient, type LinhaSugestao, type FornecedorOpt } from './sugestao-client';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

const CONSUMO_TIPOS = ['SAIDA_VENDA', 'SAIDA_FICHA_TECNICA', 'SAIDA_PRODUCAO'];

export default async function SugestaoCompraPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'cotacao.read');

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

  // Produtos controlados, com mínimo definido e estoque atual <= mínimo.
  const candidatos = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      unidade: schema.produto.unidadeEstoque,
      categoria: schema.produto.categoriaCompras,
      atual: schema.produto.estoqueAtual,
      minimo: schema.produto.estoqueMinimo,
      maximo: schema.produto.estoqueMaximo,
    })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filial.id),
        eq(schema.produto.controlaEstoque, true),
        sql`${schema.produto.estoqueMinimo} IS NOT NULL`,
        sql`${schema.produto.estoqueAtual} IS NOT NULL`,
        sql`COALESCE(${schema.produto.descontinuado}, false) = false`,
        sql`${schema.produto.estoqueAtual} <= ${schema.produto.estoqueMinimo}`,
      ),
    );

  // Consumo dos últimos 7 dias (saídas) por produto.
  const ids = candidatos.map((c) => c.id);
  const consumoPorProduto = new Map<string, number>();
  if (ids.length > 0) {
    const consumoRows = await db
      .select({
        produtoId: schema.movimentoEstoque.produtoId,
        consumo: sql<string>`COALESCE(SUM(-${schema.movimentoEstoque.quantidade}), 0)`,
      })
      .from(schema.movimentoEstoque)
      .where(
        and(
          eq(schema.movimentoEstoque.filialId, filial.id),
          inArray(schema.movimentoEstoque.produtoId, ids),
          inArray(schema.movimentoEstoque.tipo, CONSUMO_TIPOS),
          sql`${schema.movimentoEstoque.dataHora} >= now() - interval '7 days'`,
        ),
      )
      .groupBy(schema.movimentoEstoque.produtoId);
    for (const r of consumoRows) consumoPorProduto.set(r.produtoId, Number(r.consumo));
  }

  const linhas: LinhaSugestao[] = candidatos
    .map((c) => {
      const atual = Number(c.atual ?? 0);
      const minimo = Number(c.minimo ?? 0);
      const maximo = c.maximo != null ? Number(c.maximo) : null;
      const consumo7d = consumoPorProduto.get(c.id) ?? 0;
      // Sugestão: repor até o máximo. Sem máximo, repõe o consumo de 1 semana.
      const alvo = maximo != null ? maximo : atual + consumo7d;
      const sugestao = Math.max(0, Math.ceil(alvo - atual));
      return {
        produtoId: c.id,
        nome: c.nome ?? '(sem nome)',
        unidade: c.unidade,
        categoria: c.categoria,
        atual,
        minimo,
        maximo,
        consumo7d,
        sugestao,
      };
    })
    .sort((a, b) => (a.categoria ?? '').localeCompare(b.categoria ?? '', 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'));

  // Fornecedores ativos pra compras (pra montar a cotação).
  const fornecedores = await db
    .select({
      id: schema.fornecedor.id,
      nome: schema.fornecedor.nome,
      categoria: schema.fornecedor.categoriaCompras,
    })
    .from(schema.fornecedor)
    .where(and(eq(schema.fornecedor.filialId, filial.id), eq(schema.fornecedor.ativoCompras, true)))
    .orderBy(schema.fornecedor.nome);

  const fornecedorOpts: FornecedorOpt[] = fornecedores.map((f) => ({
    id: f.id,
    nome: f.nome ?? '(sem nome)',
    categoria: f.categoria,
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Sugestão de compra</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {filial.nome} · {linhas.length} produto(s) no/abaixo do mínimo · consumo dos últimos 7 dias
          </p>
        </div>

        {filiais.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {filiais.map((f) => (
              <a
                key={f.id}
                href={`?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  f.id === filial.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </a>
            ))}
          </div>
        )}

        <SugestaoClient
          filialId={filial.id}
          linhas={linhas}
          fornecedores={fornecedorOpts}
        />
      </div>
    </main>
  );
}
