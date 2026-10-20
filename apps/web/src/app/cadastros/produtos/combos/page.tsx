// COMBOS: lista dos produtos de preço fixo com etapas de escolha.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { listarCombos } from '@/lib/combos';
import { carregarRegras, resumoRegra, valeAgora } from '@/lib/combo-horario';
import { MarcarCombo } from './marcar-combo';

export const dynamic = 'force-dynamic';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default async function CombosPage(props: { searchParams: Promise<{ filial?: string; q?: string; todos?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'produto.update');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  if (filiais.length === 0) redirect('/cadastros/produtos');
  const filial = (await escolherFilial(filiais, sp.filial)) ?? filiais[0];
  const q = (sp.q ?? '').trim();
  const semAcento = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const verTodos = sp.todos === '1';
  const [todos, regras] = await Promise.all([listarCombos(filial.id), carregarRegras(filial.id)]);
  const marcados = todos.filter((c) => c.marcado);
  // Padrão: só o que está marcado como combo (combo_marcado). "Mostrar todos"
  // traz a lista de antes — todo produto com etapa que lança produto
  // (acompanhamentos do Consumer inclusive) — e é lá que se marca o combo.
  const base = verTodos ? todos : marcados;
  const combos = q ? base.filter((c) => semAcento(c.nome).includes(semAcento(q)) || String(c.varianteCodigo) === q) : base;
  const linkLista = (todosSim: boolean) =>
    `/cadastros/produtos/combos?filial=${filial.id}${todosSim ? '&todos=1' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <>
      <AppHeader userEmail={user.email} />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <nav className="text-xs text-slate-500">
          <Link href="/cadastros/produtos" className="hover:underline">Produtos</Link>
          <span className="mx-1">/</span>
          <span>Combos</span>
        </nav>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Combos</h1>
            <p className="mt-1 text-sm text-slate-600">
              Preço fixo + etapas de escolha. Cada opção lança o produto escolhido junto, com extra opcional.
            </p>
          </div>
          <Link
            href={`/cadastros/produtos/combos/novo?filial=${filial.id}`}
            className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            + Montar combo
          </Link>
        </div>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/cadastros/produtos/combos?filial=${f.id}${verTodos ? '&todos=1' : ''}`}
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

        <form className="mt-4 flex gap-2" action="/cadastros/produtos/combos">
          <input type="hidden" name="filial" value={filial.id} />
          {verTodos && <input type="hidden" name="todos" value="1" />}
          <input name="q" defaultValue={q} placeholder="buscar combo ou produto com escolhas…"
            className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
          <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">Buscar</button>
        </form>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <Link
            href={linkLista(false)}
            className={`rounded-md border px-2 py-0.5 ${!verTodos ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            Combos ({marcados.length})
          </Link>
          <Link
            href={linkLista(true)}
            className={`rounded-md border px-2 py-0.5 ${verTodos ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            Mostrar todos com escolhas ({todos.length})
          </Link>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {verTodos ? (
            <>{combos.length} de {todos.length} produto(s) com etapas que lançam produto em {filial.nome}. Use “é combo?” pra pôr na lista de combos.</>
          ) : (
            <>{combos.length} de {marcados.length} combo(s) em {filial.nome}. Prato ou bebida com acompanhamento fica em “Mostrar todos”.</>
          )}
        </p>

        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {combos.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {q ? 'Nada com esse nome.' : verTodos ? <>Nenhum produto com escolhas em {filial.nome}.</> : <>Nenhum combo em {filial.nome} ainda. Clique em “+ Montar combo” ou marque um em “Mostrar todos”.</>}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Combo</th>
                  <th className="px-4 py-2">Quando vale</th>
                  <th className="px-4 py-2 text-right">Preço</th>
                  <th className="px-4 py-2 text-right">Etapas</th>
                  <th className="px-4 py-2 text-right">Opções</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {combos.map((c) => (
                  <tr key={c.varianteCodigo}>
                    <td className="px-4 py-2 font-medium text-slate-900">
                      {c.nome} <span className="text-xs font-normal text-slate-400">#{c.varianteCodigo}</span>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {(() => {
                        const rg = regras.get(c.varianteCodigo);
                        if (!rg || !rg.ativa) return <span className="text-slate-400">sempre</span>;
                        const ok = valeAgora(rg);
                        return (
                          <span className="text-slate-600">
                            {resumoRegra(rg)}{' '}
                            <span className={`ml-1 rounded-full px-1.5 py-0.5 ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                              {ok ? 'à venda' : 'fora'}
                            </span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{brl(c.preco)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.etapas}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.opcoes}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {verTodos && (
                        <span className="mr-3">
                          <MarcarCombo filialId={filial.id} varianteCodigo={c.varianteCodigo} marcado={c.marcado} />
                        </span>
                      )}
                      <Link
                        href={`/cadastros/produtos/combos/${c.varianteCodigo}?filial=${filial.id}`}
                        className="text-xs font-medium text-slate-700 underline hover:text-slate-900"
                      >
                        editar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  );
}
