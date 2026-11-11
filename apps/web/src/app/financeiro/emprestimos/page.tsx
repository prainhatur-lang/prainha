// /financeiro/emprestimos — empréstimo (mútuo) entre empresas do sistema:
// a E.B. Serviços empresta pra uma casa cobrir contas e a casa devolve depois
// (pedido do dono 11/11/2026). Cada mútuo são duas contas a pagar origem MUTUO
// (saída na credora, devolução na devedora) — regras em lib/mutuo.
// Lançar/cancelar: só Admin. A devolução é a baixa da conta de devolução.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { ehAdmin } from '@/lib/usuario-admin';
import { filiaisDoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { AppHeader } from '@/components/app-header';
import { brl, formatDate } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { listarMutuos } from '@/lib/mutuo';
import { listarPixDasEmpresas } from '@/lib/empresa-pix';
import { CancelarMutuo, NovoMutuo, PixDasEmpresas } from './acoes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function Page() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.read');
  const admin = await ehAdmin(user.id);

  const filiais = await filiaisDoFinanceiro(user.id);
  const meus = new Set(filiais.map((f) => f.id));
  // só aparece o mútuo em que o usuário enxerga os DOIS lados (a E.B. é só do Admin)
  const todos = (await listarMutuos(filiais.map((f) => f.id))).filter((m) => meus.has(m.credoraId) && meus.has(m.devedoraId));
  const ativos = todos.filter((m) => m.status !== 'CANCELADO');
  const abertos = ativos.filter((m) => m.saldo > 0.004);
  const hoje = hojeBr();
  const pixEmpresas = await listarPixDasEmpresas(filiais.map((f) => f.id));

  // quem deve a quem (só o que está em aberto)
  const pares = new Map<string, { devedora: string; credora: string; saldo: number; qtd: number; atrasado: number }>();
  for (const m of abertos) {
    const k = `${m.devedoraId}>${m.credoraId}`;
    const p = pares.get(k) ?? { devedora: m.devedora, credora: m.credora, saldo: 0, qtd: 0, atrasado: 0 };
    p.saldo += m.saldo;
    p.qtd += 1;
    if (m.dataDevolucao < hoje) p.atrasado += m.saldo;
    pares.set(k, p);
  }
  const totalAberto = abertos.reduce((s, m) => s + m.saldo, 0);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Empréstimos entre empresas (mútuo)</h1>
          <p className="text-sm text-slate-500">
            Uma empresa empresta dinheiro pra outra e recebe de volta depois. Cada empréstimo vira duas contas: a saída em quem
            empresta e a devolução em quem recebeu. Não entra como despesa no resultado.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">A devolver (em aberto)</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-slate-900">{brl(totalAberto)}</div>
            <div className="text-xs text-slate-500">{abertos.length} empréstimo(s)</div>
          </div>
          {[...pares.values()].map((p) => (
            <div key={p.devedora + p.credora} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs text-amber-900">
                <b>{p.devedora}</b> deve a <b>{p.credora}</b>
              </div>
              <div className="mt-1 font-mono text-2xl font-semibold text-slate-900">{brl(p.saldo)}</div>
              <div className="text-xs text-slate-600">
                {p.qtd} empréstimo(s)
                {p.atrasado > 0.004 && <span className="font-medium text-red-700"> · {brl(p.atrasado)} já venceu</span>}
              </div>
            </div>
          ))}
        </div>

        {admin ? (
          <div className="mt-6">
            <NovoMutuo
              empresas={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
              hoje={hoje}
              devolucaoPadrao={diasAtrasBr(-30)}
            />
          </div>
        ) : (
          <p className="mt-6 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
            Lançar empréstimo entre empresas é só para o Admin.
          </p>
        )}

        <div className="mt-6">
          <PixDasEmpresas empresas={pixEmpresas} podeEditar={admin} />
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-3 py-2">Nº</th>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Quem emprestou</th>
                <th className="px-3 py-2">Quem recebeu</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2 text-right">Devolvido</th>
                <th className="px-3 py-2 text-right">Falta</th>
                <th className="px-3 py-2">Devolver até</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {todos.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-500">
                    Nenhum empréstimo lançado.
                  </td>
                </tr>
              )}
              {todos.map((m) => {
                const cancelado = m.status === 'CANCELADO';
                const quitado = !cancelado && m.saldo <= 0.004;
                const vencido = !cancelado && !quitado && m.dataDevolucao < hoje;
                return (
                  <tr key={m.id} className={`border-b border-slate-100 align-top ${cancelado ? 'text-slate-400 line-through' : ''}`}>
                    <td className="px-3 py-2 font-mono">{m.numero}</td>
                    <td className="px-3 py-2">{formatDate(m.data)}</td>
                    <td className="px-3 py-2">
                      {m.credora}
                      {!cancelado && m.contaSaidaId && (
                        <div className="text-xs no-underline">
                          <Link href={`/financeiro/conta/${m.contaSaidaId}`} className="text-sky-700 hover:underline">
                            {m.saiu ? 'saída paga' : 'saída a pagar →'}
                          </Link>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {m.devedora}
                      {m.observacao && <div className="text-xs text-slate-500">{m.observacao}</div>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{brl(m.valor)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {brl(m.devolvido)}
                      {m.ultimaDevolucao && <div className="text-xs text-slate-500">em {formatDate(m.ultimaDevolucao)}</div>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{cancelado ? '—' : brl(m.saldo)}</td>
                    <td className={`px-3 py-2 ${vencido ? 'font-medium text-red-700' : ''}`}>{formatDate(m.dataDevolucao)}</td>
                    <td className="px-3 py-2 text-xs">
                      {cancelado ? (
                        <span title={m.canceladoMotivo ?? ''}>cancelado</span>
                      ) : quitado ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">devolvido</span>
                      ) : vencido ? (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800">vencido</span>
                      ) : m.devolvido > 0.004 ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">devolvido em parte</span>
                      ) : (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">em aberto</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {!cancelado && m.contaDevolucaoId && (
                        <Link href={`/financeiro/conta/${m.contaDevolucaoId}`} className="font-medium text-sky-700 hover:underline">
                          {quitado ? 'ver devolução' : 'lançar devolução →'}
                        </Link>
                      )}
                      {admin && !cancelado && m.devolvido <= 0.004 && (
                        <div className="mt-1">
                          <CancelarMutuo mutuoId={m.id} numero={m.numero} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          A devolução é lançada como baixa na conta de devolução (inteira ou em partes) — pelo link da linha ou pelo contas a pagar
          da empresa que recebeu, filtro “Empréstimo”. Juros, se houver, entram no campo de juros da baixa.
        </p>
      </section>
    </main>
  );
}
