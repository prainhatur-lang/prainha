// MONTAR / EDITAR COMBO. `novo` = combo novo; número = código do tamanho.
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { carregarCombo, produtosParaEscolha } from '@/lib/combos';
import { EditorCombo } from './editor';

export const dynamic = 'force-dynamic';

export default async function ComboPage(props: {
  params: Promise<{ codigo: string }>;
  searchParams: Promise<{ filial?: string; salvo?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { codigo } = await props.params;
  const novo = codigo === 'novo';
  await exigirPerm(user.id, novo ? 'produto.create' : 'produto.update');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  if (filiais.length === 0) redirect('/cadastros/produtos');
  const filial = (await escolherFilial(filiais, sp.filial)) ?? filiais[0];

  const varianteCodigo = novo ? null : Number(codigo);
  if (!novo && !(varianteCodigo && Number.isInteger(varianteCodigo))) notFound();
  const combo = varianteCodigo ? await carregarCombo(filial.id, varianteCodigo) : null;
  if (!novo && !combo) notFound();

  const [produtos, etiquetas, pracas] = await Promise.all([
    produtosParaEscolha(filial.id),
    db
      .select({ codigo: schema.produtoEtiqueta.codigoExterno, nome: schema.produtoEtiqueta.nome })
      .from(schema.produtoEtiqueta)
      .where(eq(schema.produtoEtiqueta.filialId, filial.id))
      .orderBy(asc(schema.produtoEtiqueta.nome)),
    db
      .select({ codigo: schema.areaProducao.codigoExterno, nome: schema.areaProducao.nome })
      .from(schema.areaProducao)
      .where(and(eq(schema.areaProducao.filialId, filial.id), eq(schema.areaProducao.ativa, true)))
      .orderBy(asc(schema.areaProducao.nome)),
  ]);

  return (
    <>
      <AppHeader userEmail={user.email} />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <nav className="text-xs text-slate-500">
          <Link href="/cadastros/produtos" className="hover:underline">Produtos</Link>
          <span className="mx-1">/</span>
          <Link href={`/cadastros/produtos/combos?filial=${filial.id}`} className="hover:underline">Combos</Link>
          <span className="mx-1">/</span>
          <span>{combo ? combo.nome : 'Novo'}</span>
        </nav>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{combo ? 'Editar combo' : 'Montar combo'}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {filial.nome} · o combo tem preço fixo; em cada etapa o cliente escolhe e o produto escolhido sai junto
          (na comanda e no KDS). Extra = quanto a opção soma no preço.
        </p>

        {novo && filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/cadastros/produtos/combos/novo?filial=${f.id}`}
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

        <div className="mt-5">
          <EditorCombo
            key={JSON.stringify(combo)}
            salvo={sp.salvo}
            filialId={filial.id}
            combo={combo}
            produtos={produtos}
            etiquetas={etiquetas}
            pracas={pracas}
          />
        </div>
      </main>
    </>
  );
}
