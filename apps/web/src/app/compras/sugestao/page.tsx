// Sugestão de compra: lista produtos no/abaixo do estoque mínimo, mostra o
// consumo da última semana e sugere quanto pedir (repor até o máximo).
// Daí o usuário seleciona, ajusta e gera uma cotação (fluxo existente).

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq, ilike, inArray, isNull, not, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { avisosDemanda } from '@/lib/compras/previsao';
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
        sql`${schema.produto.estoqueAtual} IS NOT NULL`,
        sql`COALESCE(${schema.produto.descontinuado}, false) = false`,
        // Só produtos que a gente COMPRA (têm categoria de compras). Insumos
        // derivados de produção (ex.: cortes do filé) não têm categoria de
        // compras → não entram na sugestão. O consumo do filé cru já é captado
        // pela saída de produção.
        sql`${schema.produto.categoriaCompras} IS NOT NULL`,
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
      const minimo = c.minimo != null ? Number(c.minimo) : null;
      const maximo = c.maximo != null ? Number(c.maximo) : null;
      const consumo7d = consumoPorProduto.get(c.id) ?? 0;

      // Precisa repor?
      //  - COM mínimo: quando o estoque atual <= mínimo.
      //  - SEM mínimo: usa o consumo da semana como base — repõe quando tem
      //    menos de ~1 semana de cobertura (atual < consumo da semana).
      const base: 'minimo' | 'consumo' = minimo != null ? 'minimo' : 'consumo';
      const precisaRepor =
        minimo != null ? atual <= minimo : consumo7d > 0 && atual < consumo7d;

      // Alvo de reposição: máximo se definido; senão o maior entre o mínimo
      // e o consumo de 1 semana (garante cobrir a demanda da próxima semana).
      const alvo = maximo != null ? maximo : Math.max(minimo ?? 0, consumo7d);
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
        base,
        precisaRepor,
      };
    })
    .filter((l) => l.precisaRepor && l.sugestao > 0)
    .sort((a, b) => (a.categoria ?? '').localeCompare(b.categoria ?? '', 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'));

  // Fornecedores ativos pra compras (pra montar a cotação). Mesmo filtro da
  // /cotacao/nova: fora os deletados e o lixo "*Excluído*" que vem do Consumer.
  const fornecedores = await db
    .select({
      id: schema.fornecedor.id,
      nome: schema.fornecedor.nome,
      categoria: schema.fornecedor.categoriaCompras,
      valorPedidoMinimo: schema.fornecedor.valorPedidoMinimo,
    })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.filialId, filial.id),
        eq(schema.fornecedor.ativoCompras, true),
        isNull(schema.fornecedor.dataDelete),
        not(ilike(schema.fornecedor.nome, '%*excluído%')),
        not(ilike(schema.fornecedor.nome, '%excluido%')),
      ),
    )
    .orderBy(asc(schema.fornecedor.categoriaCompras), asc(schema.fornecedor.nome));

  const fornecedorOpts: FornecedorOpt[] = fornecedores.map((f) => ({
    id: f.id,
    nome: f.nome ?? '(sem nome)',
    categoria: f.categoria,
    valorPedidoMinimo: f.valorPedidoMinimo != null ? Number(f.valorPedidoMinimo) : null,
  }));

  // Quem vende cada produto sugerido (produto_fornecedor) — deixa a tela
  // ordenar/marcar sozinha quem realmente atende os itens da lista.
  const fornecedoresPorProduto: Record<string, string[]> = {};
  const idsSugeridos = linhas.map((l) => l.produtoId);
  if (idsSugeridos.length > 0) {
    const vinc = await db
      .select({
        produtoId: schema.produtoFornecedor.produtoId,
        fornecedorId: schema.produtoFornecedor.fornecedorId,
      })
      .from(schema.produtoFornecedor)
      .where(
        and(
          eq(schema.produtoFornecedor.filialId, filial.id),
          inArray(schema.produtoFornecedor.produtoId, idsSugeridos),
        ),
      );
    for (const v of vinc) {
      (fornecedoresPorProduto[v.produtoId] ??= []).push(v.fornecedorId);
    }
  }

  // Cobertura: produtos que giram estoque mas estão fora da sugestão por não
  // terem categoria de compras. Sem isso a tela parece vazia/errada mesmo com o
  // estoque rodando (foi o caso: 41 produtos girando, 5 aparecendo).
  const [{ foraPorCategoria }] = await db
    .select({ foraPorCategoria: sql<number>`count(*)::int` })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filial.id),
        eq(schema.produto.controlaEstoque, true),
        sql`COALESCE(${schema.produto.descontinuado}, false) = false`,
        isNull(schema.produto.categoriaCompras),
        sql`EXISTS (
          SELECT 1 FROM movimento_estoque m
          WHERE m.produto_id = ${schema.produto.id}
            AND m.filial_id = ${filial.id}
            AND m.data_hora >= now() - interval '90 days'
        )`,
      ),
    );

  // Avisos de demanda (clima + feriados) — só alerta, não muda quantidades.
  // Tolerante a falha de API externa.
  let avisos: Awaited<ReturnType<typeof avisosDemanda>> = [];
  try {
    avisos = await avisosDemanda(hojeBr());
  } catch {
    avisos = [];
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Sugestão de compra</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {filial.nome} · {linhas.length} produto(s) pra repor · base: estoque mínimo ou consumo dos últimos 7 dias
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

        {foraPorCategoria > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
              ⚠ {foraPorCategoria} produto(s) girando estoque estão fora desta lista
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Eles tiveram movimento nos últimos 90 dias mas não têm <b>categoria de compras</b> —
              e a sugestão só enxerga quem tem. Enquanto isso, essa lista mostra menos do que a
              casa realmente precisa repor.{' '}
              <a
                href={`/cadastros/produtos/categorizar?filialId=${filial.id}&status=sem&mov=1`}
                className="font-medium underline"
              >
                Categorizar agora →
              </a>
            </p>
          </div>
        )}

        {avisos.length > 0 && (
          <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4">
            <p className="mb-2 text-sm font-semibold text-sky-900">
              📣 Avisos de demanda (próximos dias)
            </p>
            <ul className="space-y-1">
              {avisos.map((a, i) => (
                <li key={i} className="text-xs text-slate-700">
                  {a.texto}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-sky-700">
              São só avisos pra te ajudar a decidir — as quantidades sugeridas não mudam sozinhas.
            </p>
          </div>
        )}

        <SugestaoClient
          filialId={filial.id}
          linhas={linhas}
          fornecedores={fornecedorOpts}
          fornecedoresPorProduto={fornecedoresPorProduto}
        />
      </div>
    </main>
  );
}
