// Pagina pra vincular produtos do catalogo a um fornecedor especifico.
// Lista produtos (categoria_compras NOT NULL) agrupados por categoria
// com checkbox: "este fornecedor vende este produto".
//
// Salva em batch — substitui todos os vinculos do fornecedor pelos checks atuais.
// Quando a NF chegar do fornecedor depois, ja casa com produto_fornecedor existente.

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { VincularProdutosForm } from './vincular-form';

export const dynamic = 'force-dynamic';

export default async function VincularProdutosPage(props: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  // Carrega fornecedor
  const [fornecedor] = await db
    .select({
      id: schema.fornecedor.id,
      nome: schema.fornecedor.nome,
      cnpjOuCpf: schema.fornecedor.cnpjOuCpf,
      filialId: schema.fornecedor.filialId,
      categoriaCompras: schema.fornecedor.categoriaCompras,
    })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, id))
    .limit(1);
  if (!fornecedor) notFound();

  // Carrega todos os produtos da filial com categoria_compras
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
        eq(schema.produto.filialId, fornecedor.filialId),
        isNotNull(schema.produto.categoriaCompras),
        eq(schema.produto.controlaEstoque, true),
      ),
    )
    .orderBy(asc(schema.produto.categoriaCompras), asc(schema.produto.nome));

  // Vínculos atuais
  const vincRows = await db
    .select({ produtoId: schema.produtoFornecedor.produtoId })
    .from(schema.produtoFornecedor)
    .where(eq(schema.produtoFornecedor.fornecedorId, id));
  const vinculadosAtuais = vincRows.map((v) => v.produtoId);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <Link href="/cadastros/fornecedores" className="text-xs text-slate-500 hover:underline">
          ← Fornecedores
        </Link>
        <div className="mt-2 flex items-baseline justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{fornecedor.nome}</h1>
            <p className="text-xs text-slate-500">
              {fornecedor.cnpjOuCpf ?? 'sem CNPJ'}
              {fornecedor.categoriaCompras && ` · ${fornecedor.categoriaCompras}`}
            </p>
          </div>
        </div>

        <h2 className="mt-6 text-sm font-semibold text-slate-900">Produtos que este fornecedor vende</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Marque os itens que ele costuma fornecer. Isso permite filtrar/recomendar fornecedores
          na hora de criar cotação. Não precisa marcar tudo — só o que ele realmente vende.
        </p>
        <p className="mt-1 rounded-md bg-sky-50 px-2 py-1 text-[11px] text-sky-900">
          💡 Os vínculos são <strong>replicados automaticamente</strong> pras filiais irmãs (mesmo
          CNPJ raiz do fornecedor + produto com mesmo nome). Não precisa repetir o trabalho na 0002.
        </p>

        <VincularProdutosForm
          fornecedorId={id}
          produtos={produtos.map((p) => ({
            id: p.id,
            nome: p.nome ?? '(sem nome)',
            tipo: p.tipo,
            categoria: p.categoria ?? 'Sem categoria',
            unidade: p.unidade,
          }))}
          vinculadosIniciais={vinculadosAtuais}
        />
      </div>
    </main>
  );
}
