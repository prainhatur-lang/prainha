import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq, isNotNull, isNull, not, ilike } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { NovaCotacaoForm } from './nova-cotacao';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

export default async function NovaCotacaoPage(props: { searchParams: Promise<SP> }) {
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

  // Pega produtos com categoria_compras (entram no fluxo de cotação)
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
      ),
    )
    .orderBy(asc(schema.produto.categoriaCompras), asc(schema.produto.nome));

  // Pega marcas aceitas por produto (pra mostrar como badge na UI)
  const marcasRows = await db
    .select({
      produtoId: schema.produtoMarcaAceita.produtoId,
      marca: schema.marca.nome,
    })
    .from(schema.produtoMarcaAceita)
    .innerJoin(schema.marca, eq(schema.marca.id, schema.produtoMarcaAceita.marcaId))
    .where(eq(schema.produtoMarcaAceita.filialId, filial.id))
    .orderBy(asc(schema.marca.nome));
  const marcasPorProduto: Record<string, string[]> = {};
  for (const r of marcasRows) {
    if (!marcasPorProduto[r.produtoId]) marcasPorProduto[r.produtoId] = [];
    marcasPorProduto[r.produtoId].push(r.marca);
  }

  // Pega só fornecedores ativos pra compras (filtra os 300+ legados/garcons)
  const fornecedores = await db
    .select({
      id: schema.fornecedor.id,
      nome: schema.fornecedor.nome,
      categoria: schema.fornecedor.categoriaCompras,
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

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Nova cotação</h1>
        <p className="mb-6 text-xs text-slate-500">{filial.nome}</p>

        {produtos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
            Nenhum produto desta filial está marcado pra entrar no fluxo de cotação. Rode o seed de
            compras (<code>pnpm --filter @concilia/db seed:compras</code>) ou cadastre produtos com
            categoria de compras.
          </div>
        ) : (
          <NovaCotacaoForm
            filialId={filial.id}
            produtos={produtos.map((p) => ({
              ...p,
              nome: p.nome ?? '(sem nome)',
              categoria: p.categoria ?? 'Sem categoria',
              marcasAceitas: marcasPorProduto[p.id] ?? [],
            }))}
            fornecedores={fornecedores.map((f) => ({
              ...f,
              nome: f.nome ?? '(sem nome)',
              categoria: f.categoria ?? 'Outros',
            }))}
          />
        )}
      </div>
    </main>
  );
}
