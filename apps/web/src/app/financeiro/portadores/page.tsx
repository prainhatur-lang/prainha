// /financeiro/portadores — com quem está o dinheiro em espécie de cada casa:
// Cofre, Elison, Marta… A sangria do caixa entra sozinha (vem da loja); o
// resto — entrega de um pro outro, depósito, pagamento, ajuste — é lançado
// aqui. Regras em lib/portador.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { db, schema } from '@concilia/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { brl, formatDate } from '@/lib/format';
import { hojeBr } from '@/lib/datas';
import { ROTULO_TIPO, saldosDaFilial } from '@/lib/portador';
import { AcoesMovimento, CadastroPortadores, LancarMovimento } from './acoes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SP {
  filialId?: string;
  portador?: string;
}

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.read');
  const podeLancar = await podeUsuario(user.id, 'conta_pagar.marcar_pago');

  const filiais = await filiaisDoUsuario(user.id);
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) redirect('/inicio');
  const filial = escolhida;

  const saldos = await saldosDaFilial(filial.id);
  const total = saldos.reduce((s, p) => s + p.saldo, 0);
  const filtro = sp.portador === 'sem' ? 'sem' : saldos.find((p) => p.id === sp.portador)?.id ?? null;
  const nomePortador = new Map(saldos.filter((p) => p.id).map((p) => [p.id as string, p.nome]));

  const movs = await db
    .select({
      id: schema.portadorMovimento.id,
      portadorId: schema.portadorMovimento.portadorId,
      data: schema.portadorMovimento.data,
      tipo: schema.portadorMovimento.tipo,
      valor: schema.portadorMovimento.valor,
      descricao: schema.portadorMovimento.descricao,
      quemLevou: schema.portadorMovimento.quemLevou,
    })
    .from(schema.portadorMovimento)
    .where(and(
      eq(schema.portadorMovimento.filialId, filial.id),
      isNull(schema.portadorMovimento.excluidoEm),
      filtro === 'sem'
        ? isNull(schema.portadorMovimento.portadorId)
        : filtro
          ? eq(schema.portadorMovimento.portadorId, filtro)
          : undefined,
    ))
    .orderBy(desc(schema.portadorMovimento.data), desc(schema.portadorMovimento.criadoEm))
    .limit(200);

  const ativos = saldos.filter((p) => p.id && p.ativo).map((p) => ({ id: p.id as string, nome: p.nome }));
  const link = (extra: Record<string, string>) =>
    '/financeiro/portadores?' + new URLSearchParams({ filialId: filial.id, ...extra }).toString();

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Portadores do dinheiro</h1>
            <p className="text-sm text-slate-500">
              {filial.nome} · com quem está o dinheiro que saiu da gaveta. A sangria do caixa entra sozinha.
            </p>
          </div>
          {filiais.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {filiais.map((f) => (
                <Link
                  key={f.id}
                  href={`/financeiro/portadores?filialId=${f.id}`}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                    f.id === filial.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {f.nome}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {saldos.map((p) => {
            const chave = p.id ?? 'sem';
            const on = filtro === chave;
            return (
              <Link
                key={chave}
                href={on ? link({}) : link({ portador: chave })}
                className={`rounded-xl border p-4 ${
                  p.tipo === 'SEM'
                    ? 'border-amber-300 bg-amber-50'
                    : on
                      ? 'border-slate-900 bg-white ring-2 ring-slate-900'
                      : 'border-slate-200 bg-white hover:border-slate-400'
                } ${p.ativo ? '' : 'opacity-50'}`}
              >
                <div className="text-xs font-medium text-slate-500">
                  {p.tipo === 'COFRE' ? '🔒 ' : p.tipo === 'SEM' ? '⚠ ' : '👤 '}
                  {p.nome}
                  {!p.ativo && ' (inativo)'}
                </div>
                <div className={`mt-1 text-xl font-bold ${p.saldo < 0 ? 'text-red-600' : 'text-slate-900'}`}>{brl(p.saldo)}</div>
                <div className="text-xs text-slate-400">{p.movimentos} lançamento(s)</div>
              </Link>
            );
          })}
          <div className="rounded-xl border border-slate-200 bg-slate-100 p-4">
            <div className="text-xs font-medium text-slate-500">Total em espécie</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{brl(total)}</div>
          </div>
        </div>
        {saldos.some((p) => p.tipo === 'SEM') && (
          <p className="mt-2 text-xs text-amber-700">
            ⚠ Sem portador = sangria em que o nome digitado no caixa não bate com nenhum portador. Abra e atribua.
          </p>
        )}

        {podeLancar && (
          <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
            <LancarMovimento filialId={filial.id} portadores={ativos} hoje={hojeBr()} />
            <CadastroPortadores
              filialId={filial.id}
              portadores={saldos.filter((p) => p.id).map((p) => ({ id: p.id as string, nome: p.nome, tipo: p.tipo, ativo: p.ativo }))}
            />
          </div>
        )}

        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">
              Lançamentos{filtro ? ` · ${filtro === 'sem' ? 'sem portador' : nomePortador.get(filtro)}` : ''}
            </h2>
            {filtro && (
              <Link href={link({})} className="text-xs text-slate-500 underline">
                ver todos
              </Link>
            )}
          </div>
          {movs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400">Nenhum lançamento ainda.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <tbody>
                {movs.map((m) => {
                  const v = Number(m.valor);
                  return (
                    <tr key={m.id} className="border-b border-slate-100 last:border-0">
                      <td className="whitespace-nowrap px-4 py-2 text-slate-500">{formatDate(m.data)}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-medium text-slate-700">
                        {m.portadorId ? nomePortador.get(m.portadorId) ?? '?' : <span className="text-amber-700">sem portador</span>}
                      </td>
                      <td className="px-2 py-2 text-slate-600">
                        <span className="text-slate-400">{ROTULO_TIPO[m.tipo] ?? m.tipo}</span>
                        {m.quemLevou && <span> · levou “{m.quemLevou}”</span>}
                        {m.descricao && <span> · {m.descricao}</span>}
                      </td>
                      <td className={`whitespace-nowrap px-2 py-2 text-right font-semibold ${v < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                        {v < 0 ? '− ' : '+ '}
                        {brl(Math.abs(v))}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        {podeLancar && (
                          <AcoesMovimento
                            filialId={filial.id}
                            movimentoId={m.id}
                            semPortador={!m.portadorId}
                            ehSangria={m.tipo === 'SANGRIA'}
                            portadores={ativos}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}
