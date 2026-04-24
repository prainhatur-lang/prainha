import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { AbaFicha } from './aba-ficha';
import { AbaFornecedores } from './aba-fornecedores';

export const dynamic = 'force-dynamic';

interface SP {
  aba?: 'ficha' | 'fornecedores';
}

const BADGE_TIPO: Record<string, { label: string; cls: string }> = {
  VENDA_SIMPLES: { label: 'Venda simples', cls: 'bg-slate-100 text-slate-700' },
  VENDA_COMPOSTO: { label: 'Composto', cls: 'bg-violet-100 text-violet-800' },
  INSUMO: { label: 'Insumo', cls: 'bg-sky-100 text-sky-800' },
};

export default async function ProdutoDetalhePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const sp = await props.searchParams;
  const aba = sp.aba === 'fornecedores' ? 'fornecedores' : 'ficha';

  const [produto] = await db
    .select()
    .from(schema.produto)
    .where(eq(schema.produto.id, id))
    .limit(1);
  if (!produto) notFound();

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, produto.filialId),
      ),
    )
    .limit(1);
  if (!link) notFound();

  const badge = BADGE_TIPO[produto.tipo] ?? { label: produto.tipo, cls: 'bg-slate-100' };

  // Ficha técnica (produto → insumos)
  const fichaRows = await db
    .select({
      id: schema.fichaTecnica.id,
      insumoId: schema.fichaTecnica.insumoId,
      quantidade: schema.fichaTecnica.quantidade,
      baixaEstoque: schema.fichaTecnica.baixaEstoque,
      observacao: schema.fichaTecnica.observacao,
      insumoNome: schema.produto.nome,
      insumoTipo: schema.produto.tipo,
      insumoUnidade: schema.produto.unidadeEstoque,
      insumoControla: schema.produto.controlaEstoque,
    })
    .from(schema.fichaTecnica)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.fichaTecnica.insumoId))
    .where(eq(schema.fichaTecnica.produtoId, id))
    .orderBy(asc(schema.produto.nome));

  // Onde esse produto é usado como insumo (ficha reversa)
  const usadoEmRows = await db
    .select({
      id: schema.fichaTecnica.id,
      produtoId: schema.fichaTecnica.produtoId,
      quantidade: schema.fichaTecnica.quantidade,
      produtoNome: schema.produto.nome,
    })
    .from(schema.fichaTecnica)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.fichaTecnica.produtoId))
    .where(eq(schema.fichaTecnica.insumoId, id))
    .orderBy(asc(schema.produto.nome));

  // Lista de insumos disponíveis pra adicionar na ficha (filial do produto, INSUMO ou VENDA_SIMPLES com controlaEstoque)
  const insumosDisponiveis = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      tipo: schema.produto.tipo,
      unidade: schema.produto.unidadeEstoque,
    })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, produto.filialId),
        eq(schema.produto.controlaEstoque, true),
      ),
    )
    .orderBy(asc(schema.produto.nome))
    .limit(1000);

  // Fornecedores mapeados
  const fornecedoresRows = await db
    .select({
      id: schema.produtoFornecedor.id,
      fornecedorId: schema.produtoFornecedor.fornecedorId,
      fornecedorNome: schema.fornecedor.nome,
      fornecedorCnpj: schema.fornecedor.cnpjOuCpf,
      codigoFornecedor: schema.produtoFornecedor.codigoFornecedor,
      ean: schema.produtoFornecedor.ean,
      descricaoFornecedor: schema.produtoFornecedor.descricaoFornecedor,
      unidadeFornecedor: schema.produtoFornecedor.unidadeFornecedor,
      fatorConversao: schema.produtoFornecedor.fatorConversao,
      ultimoPrecoCusto: schema.produtoFornecedor.ultimoPrecoCusto,
      ultimoPrecoCustoUnidade: schema.produtoFornecedor.ultimoPrecoCustoUnidade,
      ultimaCompraEm: schema.produtoFornecedor.ultimaCompraEm,
    })
    .from(schema.produtoFornecedor)
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.produtoFornecedor.fornecedorId))
    .where(eq(schema.produtoFornecedor.produtoId, id))
    .orderBy(asc(schema.fornecedor.nome));

  // Lista de fornecedores disponíveis (filial + não deletados)
  const fornecedoresDisponiveis = await db
    .select({
      id: schema.fornecedor.id,
      nome: schema.fornecedor.nome,
      cnpjOuCpf: schema.fornecedor.cnpjOuCpf,
    })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.filialId, produto.filialId))
    .orderBy(asc(schema.fornecedor.nome))
    .limit(1000);

  const hrefAba = (a: 'ficha' | 'fornecedores') =>
    `/cadastros/produtos/${id}${a === 'fornecedores' ? '?aba=fornecedores' : ''}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <nav className="text-xs text-slate-500">
          <Link href="/cadastros/produtos" className="hover:text-slate-800">
            ← Produtos
          </Link>
        </nav>

        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {produto.nome ?? `#${produto.codigoExterno}`}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded px-1.5 py-0.5 font-medium ${badge.cls}`}>
                {badge.label}
              </span>
              <span className="text-slate-500">
                Unidade: <span className="font-mono">{produto.unidadeEstoque}</span>
              </span>
              {produto.codigoPersonalizado && (
                <span className="text-slate-500">
                  Código: <span className="font-mono">{produto.codigoPersonalizado}</span>
                </span>
              )}
              {produto.codigoExterno && (
                <span className="text-slate-400">
                  Consumer #{produto.codigoExterno}
                </span>
              )}
              {produto.criadoNaNuvem && (
                <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-500">
                  nuvem
                </span>
              )}
              {produto.descontinuado && (
                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-800">
                  Descontinuado
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 border-b border-slate-200">
          <div className="flex gap-1">
            <Link
              href={hrefAba('ficha')}
              className={`rounded-t-lg border-b-2 px-4 py-2 text-sm ${
                aba === 'ficha'
                  ? 'border-slate-900 font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Ficha técnica
              <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                {fichaRows.length}
              </span>
            </Link>
            <Link
              href={hrefAba('fornecedores')}
              className={`rounded-t-lg border-b-2 px-4 py-2 text-sm ${
                aba === 'fornecedores'
                  ? 'border-slate-900 font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Fornecedores
              <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                {fornecedoresRows.length}
              </span>
            </Link>
          </div>
        </div>

        <div className="mt-6">
          {aba === 'ficha' ? (
            <AbaFicha
              produtoId={id}
              produtoTipo={produto.tipo}
              linhas={fichaRows.map((r) => ({
                id: r.id,
                insumoId: r.insumoId,
                insumoNome: r.insumoNome ?? '',
                insumoTipo: r.insumoTipo,
                insumoUnidade: r.insumoUnidade,
                insumoControla: r.insumoControla,
                quantidade: r.quantidade,
                baixaEstoque: r.baixaEstoque,
                observacao: r.observacao,
              }))}
              usadoEm={usadoEmRows.map((r) => ({
                id: r.id,
                produtoId: r.produtoId,
                produtoNome: r.produtoNome ?? '',
                quantidade: r.quantidade,
              }))}
              insumosDisponiveis={insumosDisponiveis
                .filter((i) => i.id !== id)
                .map((i) => ({
                  id: i.id,
                  nome: i.nome ?? '(sem nome)',
                  tipo: i.tipo,
                  unidade: i.unidade,
                }))}
            />
          ) : (
            <AbaFornecedores
              produtoId={id}
              produtoUnidade={produto.unidadeEstoque}
              linhas={fornecedoresRows.map((r) => ({
                id: r.id,
                fornecedorId: r.fornecedorId,
                fornecedorNome: r.fornecedorNome ?? '',
                fornecedorCnpj: r.fornecedorCnpj,
                codigoFornecedor: r.codigoFornecedor,
                ean: r.ean,
                descricaoFornecedor: r.descricaoFornecedor,
                unidadeFornecedor: r.unidadeFornecedor,
                fatorConversao: r.fatorConversao,
                ultimoPrecoCusto: r.ultimoPrecoCusto,
                ultimoPrecoCustoUnidade: r.ultimoPrecoCustoUnidade,
                ultimaCompraEm: r.ultimaCompraEm ? r.ultimaCompraEm.toISOString() : null,
              }))}
              fornecedoresDisponiveis={fornecedoresDisponiveis.map((f) => ({
                id: f.id,
                nome: f.nome ?? '(sem nome)',
                cnpj: f.cnpjOuCpf,
              }))}
            />
          )}
        </div>
      </section>
    </main>
  );
}
