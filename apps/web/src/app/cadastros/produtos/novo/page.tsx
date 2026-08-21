// Criar produto de VENDA no nosso banco (sem Consumer).
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { asc, eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { FormNovoProduto } from './formulario';

export const dynamic = 'force-dynamic';

export default async function NovoProdutoPage(props: {
  searchParams: Promise<{ filial?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'produto.create');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  if (filiais.length === 0) redirect('/cadastros/produtos');
  const filial = (await escolherFilial(filiais, sp.filial)) ?? filiais[0];

  const [etiquetas, pracas] = await Promise.all([
    db
      .select({ codigo: schema.produtoEtiqueta.codigoExterno, nome: schema.produtoEtiqueta.nome })
      .from(schema.produtoEtiqueta)
      .where(eq(schema.produtoEtiqueta.filialId, filial.id))
      .orderBy(asc(schema.produtoEtiqueta.nome)),
    db
      .select({ codigo: schema.areaProducao.codigoExterno, nome: schema.areaProducao.nome })
      .from(schema.areaProducao)
      .where(eq(schema.areaProducao.filialId, filial.id))
      .orderBy(asc(schema.areaProducao.nome)),
  ]);

  return (
    <>
      <AppHeader userEmail={user.email} />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <nav className="text-xs text-slate-500">
          <Link href="/cadastros/produtos" className="hover:underline">Produtos</Link>
          <span className="mx-1">/</span>
          <span>Novo produto</span>
        </nav>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Novo produto de venda</h1>
        <p className="mt-1 text-sm text-slate-600">
          Nasce no nosso banco e vai pro cardápio da loja direto — não passa pelo Consumer.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/cadastros/produtos/novo?filial=${f.id}`}
                className={`rounded-md border px-3 py-1 ${
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

        {pracas.length === 0 && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Esta filial ainda não tem praças sincronizadas — o produto pode ser criado, mas não vai
            aparecer no KDS até a loja mandar a lista de cozinhas.
          </p>
        )}

        <div className="mt-5">
          <FormNovoProduto
            filialId={filial.id}
            filialNome={filial.nome}
            etiquetas={etiquetas}
            pracas={pracas}
          />
        </div>
      </main>
    </>
  );
}
