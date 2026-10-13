// /financeiro/cartoes — faturas de cartão de crédito da empresa. O arquivo do
// banco (PDF, planilha ou CSV) é enviado aqui, lido linha por linha e a soma é
// conferida com o total que o banco informa. A tela não gera conta a pagar nem
// baixa: mostra o que cada fatura cobrou. Regras em lib/cartao-fatura.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { brl, formatDate, int } from '@/lib/format';
import {
  PERM_CARTAO_ENVIAR,
  PERM_CARTAO_VER,
  acessoCartoes,
  categoriasEmUso,
  faturaVisivel,
  faturasDaOrganizacao,
  lancamentosDaFatura,
} from '@/lib/cartao-fatura';
import { AcoesFatura, EnviarFaturas } from './enviar';
import { LancamentosEditaveis } from './classificar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SP {
  fatura?: string;
}

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, PERM_CARTAO_VER);

  const acesso = await acessoCartoes(user.id);
  const podeEnviar = acesso ? await podeUsuario(user.id, PERM_CARTAO_ENVIAR) : false;
  const faturas = acesso ? await faturasDaOrganizacao(acesso.organizacaoId) : [];
  const aberta = sp.fatura ? await faturaVisivel(user.id, sp.fatura) : null;
  const lancamentos = aberta ? await lancamentosDaFatura(aberta.id) : [];

  const porCategoria = new Map<string, number>();
  for (const l of lancamentos) {
    const c = l.categoria ?? 'Sem categoria';
    porCategoria.set(c, (porCategoria.get(c) ?? 0) + Number(l.valor));
  }
  const categorias = [...porCategoria.entries()].sort((a, b) => b[1] - a[1]);
  const categoriasOpcoes = acesso && aberta && podeEnviar ? await categoriasEmUso(acesso.organizacaoId) : [];
  const nomeCasa = new Map((acesso?.filiais ?? []).map((f) => [f.id, f.nome]));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Faturas de cartão</h1>
          <Link
            href="/financeiro"
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Financeiro
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Envie a fatura como o banco entrega — PDF, planilha (XLS/XLSX) ou CSV. O sistema lê cada lançamento e
          confere a soma com o total da fatura.
        </p>

        {!acesso ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            As faturas de cartão são da empresa inteira: só aparecem pra quem tem acesso a todas as casas.
          </div>
        ) : (
          <>
            {podeEnviar ? <EnviarFaturas /> : null}

            <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Cartão</th>
                    <th className="px-3 py-2">Vencimento</th>
                    <th className="px-3 py-2 text-right">Total do banco</th>
                    <th className="px-3 py-2 text-right">Soma lida</th>
                    <th className="px-3 py-2 text-right">Lançamentos</th>
                    <th className="px-3 py-2">Conferência</th>
                    <th className="px-3 py-2">Arquivo</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {faturas.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                        Nenhuma fatura enviada ainda.
                      </td>
                    </tr>
                  ) : null}
                  {faturas.map((f) => {
                    const dif = f.total !== null && f.somaLida !== null ? f.somaLida - f.total : null;
                    return (
                      <tr key={f.id} className={`border-t border-slate-100 ${aberta?.id === f.id ? 'bg-sky-50' : ''}`}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">
                            {f.banco ?? '—'} {f.cartaoFinal ? `final ${f.cartaoFinal}` : ''}
                          </div>
                          {f.titular ? <div className="text-xs text-slate-500">{f.titular}</div> : null}
                        </td>
                        <td className="px-3 py-2">{f.vencimento ? formatDate(f.vencimento) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{f.total === null ? '—' : brl(f.total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{f.somaLida === null ? '—' : brl(f.somaLida)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{int(f.qtdLancamentos)}</td>
                        <td className="px-3 py-2">
                          {f.status === 'LIDA' ? (
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                              confere
                            </span>
                          ) : f.status === 'DIVERGE' ? (
                            <div>
                              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                                não confere
                              </span>
                              <div className="mt-0.5 text-xs text-amber-800">
                                {dif !== null ? `diferença de ${brl(dif)}` : f.erro}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                                não foi lida
                              </span>
                              {f.erro ? <div className="mt-0.5 max-w-xs text-xs text-red-700">{f.erro}</div> : null}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <a
                            href={`/api/cartoes/faturas/${f.id}`}
                            className="text-xs text-sky-700 underline"
                            title={f.nome}
                          >
                            baixar
                          </a>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {f.qtdLancamentos > 0 ? (
                            <Link href={`/financeiro/cartoes?fatura=${f.id}`} className="mr-3 text-xs text-sky-700 underline">
                              ver lançamentos
                            </Link>
                          ) : null}
                          {podeEnviar ? <AcoesFatura id={f.id} /> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {aberta ? (
              <div className="mt-8">
                <h2 className="text-lg font-semibold text-slate-900">
                  {aberta.banco ?? 'Fatura'} {aberta.cartaoFinal ? `final ${aberta.cartaoFinal}` : ''}
                  {aberta.vencimento ? ` — vencimento ${formatDate(aberta.vencimento)}` : ''}
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {categorias.map(([c, v]) => (
                    <span key={c} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">
                      {c}: <strong className="tabular-nums">{brl(v)}</strong>
                    </span>
                  ))}
                </div>
                {podeEnviar && acesso ? (
                  <LancamentosEditaveis
                    categorias={categoriasOpcoes}
                    filiais={acesso.filiais}
                    linhas={lancamentos.map((l) => ({
                      id: l.id,
                      data: l.dataCompra ? formatDate(l.dataCompra) : '—',
                      cartao: l.cartaoFinal ?? '—',
                      estabelecimento: l.estabelecimento,
                      parcela: l.parcela && l.totalParcelas ? `${l.parcela}/${l.totalParcelas}` : '—',
                      categoria: l.categoria,
                      filialId: l.filialId,
                      valor: brl(l.valor),
                      credito: Number(l.valor) < 0,
                    }))}
                  />
                ) : (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Data</th>
                        <th className="px-3 py-2">Cartão</th>
                        <th className="px-3 py-2">Estabelecimento</th>
                        <th className="px-3 py-2">Parcela</th>
                        <th className="px-3 py-2">Categoria sugerida</th>
                        <th className="px-3 py-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lancamentos.map((l) => (
                        <tr key={l.id} className="border-t border-slate-100">
                          <td className="px-3 py-1.5">{l.dataCompra ? formatDate(l.dataCompra) : '—'}</td>
                          <td className="px-3 py-1.5 text-slate-500">{l.cartaoFinal ?? '—'}</td>
                          <td className="px-3 py-1.5">{l.estabelecimento}</td>
                          <td className="px-3 py-1.5 text-slate-500">
                            {l.parcela && l.totalParcelas ? `${l.parcela}/${l.totalParcelas}` : '—'}
                          </td>
                          <td className="px-3 py-1.5">
                            {l.categoria ?? <span className="text-amber-700">sem categoria</span>}
                            {l.filialId && nomeCasa.get(l.filialId) ? (
                              <span className="ml-2 text-xs text-slate-500">· {nomeCasa.get(l.filialId)}</span>
                            ) : null}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right tabular-nums ${Number(l.valor) < 0 ? 'text-emerald-700' : ''}`}
                          >
                            {brl(l.valor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
