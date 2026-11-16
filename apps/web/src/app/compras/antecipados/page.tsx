// Conferência dos antecipados (dono, 16/11/2026): "ter uma conferência do que
// está antecipado, se chegou ou não chegou". Lista as compras cuja conta a
// pagar foi lançada pelo botão "Pagar antecipado" da nota/pedido, separando o
// que ainda NÃO chegou do que já chegou (conferência da nota ou estoque lançado).

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { listarAntecipados, type Antecipado } from '@/lib/antecipado';
import { MarcarChegou } from './marcar-chegou';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

function rotuloDe(a: Antecipado): string {
  const n = a.numero ? ` nº ${a.numero}` : '';
  return `${a.pedidoSemNota ? 'Pedido sem nota' : 'Nota'}${n}`;
}

function Pagamento({ a }: { a: Antecipado }) {
  if (a.parcelas > 0 && a.parcelasPagas === a.parcelas) {
    return (
      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
        pago{a.pagoEm ? ` ${a.pagoEm}` : ''}
      </span>
    );
  }
  if (a.parcelasPagas > 0) {
    return (
      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
        pago {a.parcelasPagas}/{a.parcelas}
      </span>
    );
  }
  return (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
      conta em aberto (ainda não pago)
    </span>
  );
}

function Linha({ a }: { a: Antecipado }) {
  const pago = a.parcelasPagas > 0;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-slate-900">{a.fornecedor ?? '(sem fornecedor)'}</span>
          <Link
            href={`/movimento/entrada-notas/${a.notaId}`}
            className="text-xs text-sky-700 underline-offset-2 hover:underline"
          >
            {rotuloDe(a)}
          </Link>
          <span className="font-mono text-sm font-semibold text-slate-900">{brl(a.valor)}</span>
          <Pagamento a={a} />
        </div>
        {a.itens && <p className="mt-0.5 truncate text-xs text-slate-600">{a.itens}</p>}
        <p className="mt-0.5 text-[11px] text-slate-500">
          lançado em {a.lancadoEm ?? '—'}
          {!a.chegou && a.diasDesdeLancado > 0 && (
            <span className={pago && a.diasDesdeLancado > 7 ? 'font-semibold text-rose-700' : ''}>
              {' '}· há {a.diasDesdeLancado} dia{a.diasDesdeLancado > 1 ? 's' : ''} sem chegar
            </span>
          )}
          {a.chegou && a.conferidaEm && (
            <span>
              {' '}· conferido {a.conferidaEm}
              {a.conferidaPor ? ` por ${a.conferidaPor}` : ''}
            </span>
          )}
          {a.chegou && !a.conferidaEm && <span> · entrou no estoque</span>}
          {a.itensTotal > 0 && a.itensLancados > 0 && a.itensLancados < a.itensTotal && (
            <span> · {a.itensLancados}/{a.itensTotal} itens no estoque</span>
          )}
        </p>
        {a.chegou && a.conferenciaObs && (
          <p className="mt-0.5 text-[11px] italic text-slate-500">{a.conferenciaObs}</p>
        )}
      </div>
      {!a.chegou && (
        <div className="flex flex-col items-end gap-1">
          <MarcarChegou notaId={a.notaId} rotulo={`${a.fornecedor ?? ''} ${rotuloDe(a)}`.trim()} />
          <Link
            href={`/movimento/entrada-notas/${a.notaId}`}
            className="text-[11px] text-slate-500 underline-offset-2 hover:underline"
          >
            Conferir item a item
          </Link>
        </div>
      )}
    </div>
  );
}

export default async function AntecipadosPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'nota_compra.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = escolhida;

  const todos = await listarAntecipados(filial.id);
  const faltam = todos.filter((a) => !a.chegou);
  const chegaram = todos.filter((a) => a.chegou).reverse();
  const pagoSemChegar = faltam.filter((a) => a.parcelasPagas > 0);
  const soma = (l: Antecipado[]) => l.reduce((s, a) => s + a.valor, 0);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Antecipados: chegou ou não chegou</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {filial.nome} · compras lançadas pelo botão “💸 Pagar antecipado” na tela da nota ou do pedido sem nota
          </p>
        </div>

        {filiais.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1 text-xs">
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/compras/antecipados?filialId=${f.id}`}
                className={`rounded-md border px-2 py-1 ${
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

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <div className="text-[10px] uppercase tracking-wide text-rose-700">Pago e não chegou</div>
            <div className="mt-1 text-2xl font-bold text-rose-900">{brl(soma(pagoSemChegar))}</div>
            <div className="mt-0.5 text-[11px] text-rose-700">{pagoSemChegar.length} compra(s)</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-[10px] uppercase tracking-wide text-amber-700">Aguardando chegar</div>
            <div className="mt-1 text-2xl font-bold text-amber-900">{brl(soma(faltam))}</div>
            <div className="mt-0.5 text-[11px] text-amber-700">{faltam.length} compra(s), pagas ou não</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-[10px] uppercase tracking-wide text-emerald-700">Já chegou</div>
            <div className="mt-1 text-2xl font-bold text-emerald-900">{brl(soma(chegaram))}</div>
            <div className="mt-0.5 text-[11px] text-emerald-700">{chegaram.length} compra(s)</div>
          </div>
        </div>

        <section className="mb-6 rounded-xl border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-900">
            ⏳ Não chegou ainda ({faltam.length})
          </h2>
          {faltam.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">
              Nada pendente. Compra paga antes de chegar aparece aqui quando alguém usa o botão “💸 Pagar
              antecipado” na tela da nota.
            </p>
          ) : (
            faltam.map((a) => <Linha key={a.notaId} a={a} />)
          )}
        </section>

        {chegaram.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white">
            <h2 className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-900">
              ✅ Já chegou ({chegaram.length})
            </h2>
            {chegaram.map((a) => (
              <Linha key={a.notaId} a={a} />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
