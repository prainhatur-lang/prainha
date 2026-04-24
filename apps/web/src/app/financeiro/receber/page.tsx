import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  filtro?: 'devem' | 'credor' | 'zerado' | 'todos';
}

export default async function ContasReceberPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;
  const filtro = sp.filtro ?? 'devem';

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  // Saldo por cliente: soma credito - soma debito dos movimentos
  // Credito aumenta divida do cliente; debito reduz (pagamento).
  const saldos = await db
    .select({
      clienteId: schema.movimentoContaCorrente.clienteId,
      codigoClienteExterno: schema.movimentoContaCorrente.codigoClienteExterno,
      saldo: sql<string>`COALESCE(SUM(${schema.movimentoContaCorrente.credito}), 0)
        - COALESCE(SUM(${schema.movimentoContaCorrente.debito}), 0)`,
      totalCredito: sql<string>`COALESCE(SUM(${schema.movimentoContaCorrente.credito}), 0)`,
      totalDebito: sql<string>`COALESCE(SUM(${schema.movimentoContaCorrente.debito}), 0)`,
      ultimoMov: sql<Date>`MAX(${schema.movimentoContaCorrente.dataHora})`,
      qtd: sql<number>`COUNT(*)::int`,
    })
    .from(schema.movimentoContaCorrente)
    .where(eq(schema.movimentoContaCorrente.filialId, filialSelecionada.id))
    .groupBy(
      schema.movimentoContaCorrente.clienteId,
      schema.movimentoContaCorrente.codigoClienteExterno,
    );

  // Pega nomes dos clientes
  const clientesRaw = await db
    .select({
      id: schema.cliente.id,
      codigoExterno: schema.cliente.codigoExterno,
      nome: schema.cliente.nome,
      cpfOuCnpj: schema.cliente.cpfOuCnpj,
    })
    .from(schema.cliente)
    .where(
      and(
        eq(schema.cliente.filialId, filialSelecionada.id),
        isNull(schema.cliente.dataDelete),
      ),
    );
  const clienteById = new Map(clientesRaw.map((c) => [c.id, c]));
  const clienteByCodigo = new Map(clientesRaw.map((c) => [c.codigoExterno, c]));

  const linhas = saldos
    .map((s) => {
      const saldo = +Number(s.saldo).toFixed(2);
      const c = s.clienteId
        ? clienteById.get(s.clienteId)
        : s.codigoClienteExterno != null
          ? clienteByCodigo.get(s.codigoClienteExterno)
          : null;
      return {
        key: s.clienteId ?? `ext-${s.codigoClienteExterno}`,
        nome: c?.nome ?? (s.codigoClienteExterno ? `Cliente #${s.codigoClienteExterno}` : 'Sem cliente'),
        cpf: c?.cpfOuCnpj ?? null,
        saldo,
        totalCredito: Number(s.totalCredito),
        totalDebito: Number(s.totalDebito),
        ultimoMov: s.ultimoMov,
        qtd: Number(s.qtd),
      };
    })
    .filter((l) => {
      if (filtro === 'devem') return l.saldo > 0.01;
      if (filtro === 'credor') return l.saldo < -0.01;
      if (filtro === 'zerado') return Math.abs(l.saldo) <= 0.01;
      return true;
    })
    .sort((a, b) => b.saldo - a.saldo);

  // KPIs
  const totalDevem = saldos.reduce((s, r) => {
    const v = Number(r.saldo);
    return v > 0 ? s + v : s;
  }, 0);
  const qtdDevem = saldos.filter((r) => Number(r.saldo) > 0.01).length;
  const totalCredor = saldos.reduce((s, r) => {
    const v = Number(r.saldo);
    return v < 0 ? s + v : s;
  }, 0);
  const qtdCredor = saldos.filter((r) => Number(r.saldo) < -0.01).length;

  const href = (f: NonNullable<SP['filtro']>) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    if (f !== 'devem') qs.set('filtro', f);
    return `/financeiro/receber?${qs.toString()}`;
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Contas a receber</h1>
        <p className="mt-1 text-sm text-slate-600">
          Saldo de conta corrente por cliente. Saldo positivo = cliente deve (venda a prazo).
          Saldo negativo = cliente tem crédito com a loja.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/financeiro/receber?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === filialSelecionada.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        {/* KPIs */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Link
            href={href('devem')}
            className="rounded-xl border border-rose-200 bg-rose-50 p-4 hover:shadow-sm"
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-rose-700">
              Clientes devendo
            </p>
            <p className="mt-1 text-2xl font-bold text-rose-900">{int(qtdDevem)}</p>
            <p className="text-xs text-rose-700">{brl(totalDevem)}</p>
          </Link>
          <Link
            href={href('credor')}
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 hover:shadow-sm"
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
              Clientes credores
            </p>
            <p className="mt-1 text-2xl font-bold text-emerald-900">{int(qtdCredor)}</p>
            <p className="text-xs text-emerald-700">{brl(Math.abs(totalCredor))}</p>
          </Link>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Saldo líquido a receber
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {brl(totalDevem + totalCredor)}
            </p>
            <p className="text-xs text-slate-600">devedores − credores</p>
          </div>
        </div>

        {/* Pills */}
        <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
          {([
            ['devem', 'Devendo'],
            ['credor', 'Credores'],
            ['zerado', 'Zerados'],
            ['todos', 'Todos'],
          ] as Array<[NonNullable<SP['filtro']>, string]>).map(([k, label]) => (
            <Link
              key={k}
              href={href(k)}
              className={`rounded-md border px-3 py-1 ${
                filtro === k
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">CPF/CNPJ</th>
                <th className="px-4 py-2 text-right">Total creditado</th>
                <th className="px-4 py-2 text-right">Total pago</th>
                <th className="px-4 py-2 text-right">Saldo</th>
                <th className="px-4 py-2 text-right">Movs</th>
                <th className="px-4 py-2">Último movimento</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-500">
                    {saldos.length === 0
                      ? 'Aguardando sincronização do agente.'
                      : 'Nenhum cliente nesse filtro.'}
                  </td>
                </tr>
              ) : (
                linhas.slice(0, 500).map((l) => (
                  <tr key={l.key} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-xs text-slate-800">{l.nome}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{l.cpf ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                      {brl(l.totalCredito)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                      {brl(l.totalDebito)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono text-sm font-medium ${
                        l.saldo > 0.01
                          ? 'text-rose-700'
                          : l.saldo < -0.01
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                      }`}
                    >
                      {brl(l.saldo)}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-slate-500">{int(l.qtd)}</td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {l.ultimoMov
                        ? new Date(l.ultimoMov).toLocaleDateString('pt-BR')
                        : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {linhas.length > 500 && (
            <p className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-center text-xs text-slate-500">
              Mostrando 500 de {int(linhas.length)}. Use o filtro pra refinar.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
