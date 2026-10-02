// Transferências entre casas (regra em @/lib/transferencia): o que a casa
// ativa ENVIOU (a receber das outras) e RECEBEU (a pagar), por competência.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { hojeBr } from '@/lib/datas';
import { compLabel } from '@/lib/transferencia';
import { CancelarTransfButton } from './cancelar-btn';
import { nfesDasTransferencias } from '@/lib/nfe/emitir';
import { EmitirNfeButton } from './nfe-btn';

export const dynamic = 'force-dynamic';

const BADGE: Record<string, { label: string; cls: string }> = {
  ENVIADA: { label: 'Em trânsito', cls: 'bg-sky-100 text-sky-800' },
  ABERTA: { label: 'Em aberto', cls: 'bg-amber-100 text-amber-800' },
  COMPENSADA: { label: 'Compensada', cls: 'bg-emerald-100 text-emerald-800' },
  CANCELADA: { label: 'Cancelada', cls: 'bg-slate-200 text-slate-600' },
};

const dataBr = (d: string) => d.split('-').reverse().join('/');

export default async function TransferenciasPage(props: {
  searchParams: Promise<{ filialId?: string; comp?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'nota_compra.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const sel = await escolherFilial(filiais, sp.filialId);
  if (!sel) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = sel;
  const comp = sp.comp && /^\d{4}-\d{2}$/.test(sp.comp) ? sp.comp : hojeBr().slice(0, 7);
  const [y, m] = comp.split('-').map(Number) as [number, number];
  const compAnt = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
  const compProx = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;

  const lista = await db
    .select()
    .from(schema.transferenciaFilial)
    .where(
      and(
        eq(schema.transferenciaFilial.competencia, comp),
        or(
          eq(schema.transferenciaFilial.filialOrigemId, filial.id),
          eq(schema.transferenciaFilial.filialDestinoId, filial.id),
        ),
      ),
    )
    .orderBy(desc(schema.transferenciaFilial.data), desc(schema.transferenciaFilial.numero));

  // Em trânsito (ENVIADA) de/pra esta casa, de qualquer mês: quem recebe
  // confere e dá entrada; quem enviou acompanha.
  const emTransito = await db
    .select()
    .from(schema.transferenciaFilial)
    .where(
      and(
        eq(schema.transferenciaFilial.status, 'ENVIADA'),
        or(
          eq(schema.transferenciaFilial.filialOrigemId, filial.id),
          eq(schema.transferenciaFilial.filialDestinoId, filial.id),
        ),
      ),
    )
    .orderBy(desc(schema.transferenciaFilial.data), desc(schema.transferenciaFilial.numero));
  const aConferir = emTransito.filter((t) => t.filialDestinoId === filial.id);
  const aCaminho = emTransito.filter((t) => t.filialOrigemId === filial.id);

  const idsItens = [...new Set([...lista, ...emTransito].map((t) => t.id))];
  const itens = idsItens.length
    ? await db
        .select({
          transferenciaId: schema.transferenciaFilialItem.transferenciaId,
          descricao: schema.transferenciaFilialItem.descricao,
          quantidade: schema.transferenciaFilialItem.quantidade,
          valorTotal: schema.transferenciaFilialItem.valorTotal,
        })
        .from(schema.transferenciaFilialItem)
        .where(inArray(schema.transferenciaFilialItem.transferenciaId, idsItens))
    : [];
  const itensPor = new Map<string, typeof itens>();
  for (const it of itens) {
    const a = itensPor.get(it.transferenciaId) ?? [];
    a.push(it);
    itensPor.set(it.transferenciaId, a);
  }

  // Nota fiscal (NF-e) de cada transferência — opcional, emitida por quem enviou
  const nfes = await nfesDasTransferencias(idsItens);

  const todasFiliais = await db.select({ id: schema.filial.id, nome: schema.filial.nome }).from(schema.filial);
  const nome = new Map(todasFiliais.map((f) => [f.id, f.nome]));

  // Saldo em aberto por outra casa: + = ela me deve; − = eu devo
  const saldoPorCasa = new Map<string, number>();
  let aReceber = 0;
  let aPagar = 0;
  for (const t of lista) {
    if (t.status !== 'ABERTA') continue;
    const v = Number(t.valorTotal);
    if (t.filialOrigemId === filial.id) {
      aReceber += v;
      saldoPorCasa.set(t.filialDestinoId, (saldoPorCasa.get(t.filialDestinoId) ?? 0) + v);
    } else {
      aPagar += v;
      saldoPorCasa.set(t.filialOrigemId, (saldoPorCasa.get(t.filialOrigemId) ?? 0) - v);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Transferências entre casas</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Mercadoria que sai de uma casa pra outra pelo custo médio de quem envia. Quem recebe confere,
              dá entrada no estoque e fica devendo (conta a pagar); no fim do mês o encontro de contas compensa e sobra uma conta só
              com a diferença.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/movimento/transferencias/encontro?comp=${comp}`}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              ⚖️ Encontro de contas
            </Link>
            <Link
              href={`/movimento/transferencias/nova?filialId=${filial.id}`}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              + Nova transferência
            </Link>
          </div>
        </div>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Casa:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/movimento/transferencias?filialId=${f.id}&comp=${comp}`}
                className={`rounded-md border px-3 py-1 text-xs ${
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

        {aConferir.length > 0 && (
          <div className="mt-4 rounded-xl border border-sky-300 bg-sky-50 p-4">
            <p className="text-sm font-semibold text-sky-900">
              📦 A receber em {filial.nome} — {aConferir.length} transferência(s) a caminho
            </p>
            <p className="text-xs text-sky-800">
              Quando a mercadoria chegar, confira os itens: só aí ela entra no estoque daqui.
            </p>
            <ul className="mt-3 space-y-2">
              {aConferir.map((t) => {
                const its = itensPor.get(t.id) ?? [];
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-white px-3 py-2">
                    <div className="text-sm">
                      <span className="font-mono text-xs text-slate-500">#{t.numero}</span>{' '}
                      <span className="font-medium text-slate-800">de {nome.get(t.filialOrigemId)}</span>{' '}
                      <span className="text-slate-500">· enviada em {dataBr(t.data)} · {its.length} item(ns) · {brl(t.valorTotal)}</span>
                      <div className="text-xs text-slate-500">
                        {its.slice(0, 3).map((i) => `${Number(i.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} × ${i.descricao}`).join(' · ')}
                        {its.length > 3 ? ` · +${its.length - 3}` : ''}
                      </div>
                    </div>
                    <Link
                      href={`/movimento/transferencias/${t.id}/receber`}
                      className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800"
                    >
                      Conferir e receber
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {aCaminho.length > 0 && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-800">
              🚚 Enviadas por {filial.nome}, aguardando conferência — {aCaminho.length}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {aCaminho.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    <span className="font-mono text-xs text-slate-500">#{t.numero}</span> pra {nome.get(t.filialDestinoId)}{' '}
                    <span className="text-slate-500">· {dataBr(t.data)} · {brl(t.valorTotal)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {!(nfes.get(t.id)?.status === 'AUTORIZADA' && nfes.get(t.id)?.ambiente === 1) && (
                      <EmitirNfeButton id={t.id} numero={t.numero} />
                    )}
                    <CancelarTransfButton id={t.id} numero={t.numero} emTransito />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 text-sm">
          <Link href={`/movimento/transferencias?filialId=${filial.id}&comp=${compAnt}`} className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50">←</Link>
          <span className="font-semibold text-slate-800">Competência {compLabel(comp)}</span>
          <Link href={`/movimento/transferencias?filialId=${filial.id}&comp=${compProx}`} className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50">→</Link>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">A receber (enviou, em aberto)</p>
            <p className="mt-1 text-2xl font-bold text-emerald-700">{brl(aReceber)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">A pagar (recebeu, em aberto)</p>
            <p className="mt-1 text-2xl font-bold text-rose-700">{brl(aPagar)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Saldo por casa</p>
            {saldoPorCasa.size === 0 ? (
              <p className="mt-1 text-sm text-slate-400">nada em aberto</p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {[...saldoPorCasa.entries()].map(([fid, v]) => (
                  <li key={fid} className="flex justify-between gap-2">
                    <span className="text-slate-700">{nome.get(fid)}</span>
                    <span className={v >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
                      {v >= 0 ? `me deve ${brl(v)}` : `devo ${brl(-v)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Sentido</th>
                <th className="px-3 py-2">Itens</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    Nenhuma transferência em {compLabel(comp)}.
                  </td>
                </tr>
              )}
              {lista.map((t) => {
                const enviou = t.filialOrigemId === filial.id;
                const its = itensPor.get(t.id) ?? [];
                const b = BADGE[t.status] ?? { label: t.status, cls: 'bg-slate-100 text-slate-700' };
                const nf = nfes.get(t.id);
                const nfValida = nf?.status === 'AUTORIZADA' && nf.ambiente === 1;
                return (
                  <tr key={t.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{t.numero}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{dataBr(t.data)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {enviou ? (
                        <span className="text-emerald-700">→ enviou pra {nome.get(t.filialDestinoId)}</span>
                      ) : t.status === 'ENVIADA' ? (
                        <span className="text-sky-700">← a caminho, de {nome.get(t.filialOrigemId)}</span>
                      ) : (
                        <span className="text-rose-700">← recebeu de {nome.get(t.filialOrigemId)}</span>
                      )}
                      {t.notaCompraId && (
                        <Link href={`/movimento/entrada-notas/${t.notaCompraId}`} className="ml-2 text-xs text-sky-700 underline">
                          nota
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {its.slice(0, 4).map((i, k) => (
                        <div key={k}>
                          {Number(i.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} × {i.descricao}
                        </div>
                      ))}
                      {its.length > 4 && <div className="text-slate-400">+{its.length - 4} itens</div>}
                      {t.observacao && <div className="mt-1 italic text-slate-400">{t.observacao}</div>}
                      {t.observacaoRecebimento && (
                        <div className="mt-1 italic text-slate-400">recebimento: {t.observacaoRecebimento}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{brl(t.valorTotal)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${b.cls}`}>{b.label}</span>
                      {nf && (
                        <Link
                          href={`/movimento/transferencias/${t.id}/nfe`}
                          title={nf.status === 'REJEITADA' ? `${nf.cstat ?? ''} ${nf.xmotivo ?? ''}` : nf.chave}
                          className={`mt-1 block whitespace-nowrap text-xs underline ${
                            nf.status === 'AUTORIZADA' ? 'text-indigo-700' : nf.status === 'CANCELADA' ? 'text-slate-400' : 'text-rose-700'
                          }`}
                        >
                          🧾 NF-e {nf.numero}
                          {nf.ambiente !== 1 ? ' (teste)' : ''}
                          {nf.status === 'AUTORIZADA' ? '' : ` — ${nf.status.toLowerCase()}`}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {enviou && t.status !== 'CANCELADA' && !nfValida && (
                        <div className="mb-1">
                          <EmitirNfeButton id={t.id} numero={t.numero} />
                        </div>
                      )}
                      {t.status === 'ABERTA' && <CancelarTransfButton id={t.id} numero={t.numero} />}
                      {t.status === 'ENVIADA' && (
                        <div className="flex flex-col items-end gap-1">
                          {!enviou && (
                            <Link
                              href={`/movimento/transferencias/${t.id}/receber`}
                              className="rounded bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800"
                            >
                              Conferir e receber
                            </Link>
                          )}
                          <CancelarTransfButton id={t.id} numero={t.numero} emTransito />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
