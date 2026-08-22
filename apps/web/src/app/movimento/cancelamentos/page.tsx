// Histórico de cancelamentos do caixa (vendas-local) COM motivo — o que o
// Consumer não guarda. A loja envia pra cancelamento_item; aqui é leitura:
// quem cancelou, quem autorizou, o que, quanto, por quê — e quanto disso já
// tinha saído da cozinha (desperdício).

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, count, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDateTime, int } from '@/lib/format';
import { hojeBr, diasAtrasBr, brDateStart, brDateEnd } from '@/lib/datas';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  dataIni?: string;
  dataFim?: string;
  motivo?: string;
  quem?: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** a_produzir = cancelou antes de ir pra cozinha; o resto já tinha custado. */
function rotuloStatus(s: string | null): string {
  if (!s) return '—';
  if (s === 'a_produzir') return 'antes de produzir';
  if (s === 'pedido') return 'pedido inteiro';
  return s.replace(/_/g, ' ');
}
function jaProduzido(s: string | null): boolean {
  return !!s && s !== 'a_produzir' && s !== 'pedido';
}

interface Grupo {
  chave: string;
  qtd: number;
  valor: number;
}
function agrupar<T>(linhas: T[], chaveDe: (l: T) => string, valorDe: (l: T) => number): Grupo[] {
  const m = new Map<string, Grupo>();
  for (const l of linhas) {
    const k = chaveDe(l);
    const g = m.get(k) ?? { chave: k, qtd: 0, valor: 0 };
    g.qtd += 1;
    g.valor += valorDe(l);
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.valor - a.valor || b.qtd - a.qtd);
}

export default async function CancelamentosPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conciliacao.read');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const filialSel = await escolherFilial(filiais, sp.filialId);
  const hoje = hojeBr();
  const dataIni = sp.dataIni && YMD.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(30);
  const dataFim = sp.dataFim && YMD.test(sp.dataFim) ? sp.dataFim : hoje;
  const motivoSel = (sp.motivo ?? '').trim();
  const quemSel = (sp.quem ?? '').trim().toLowerCase();

  if (!filialSel) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = filialSel; // alias depois da guarda (narrowing some em closures)

  const c = schema.cancelamentoItem;
  const linhas = await db
    .select({
      id: c.id,
      quando: c.quando,
      tipo: c.tipo,
      login: c.login,
      gerente: c.gerente,
      numero: c.numero,
      nome: c.nome,
      valor: c.valor,
      statusItem: c.statusItem,
      motivo: c.motivo,
      areaCodigo: c.areaCodigo,
    })
    .from(c)
    .where(
      and(
        eq(c.filialId, filial.id),
        gte(c.quando, brDateStart(dataIni)),
        lte(c.quando, brDateEnd(dataFim)),
        motivoSel ? eq(c.motivo, motivoSel) : undefined,
        quemSel ? eq(c.login, quemSel) : undefined,
      ),
    )
    .orderBy(desc(c.quando))
    .limit(500);

  const motivos = await db
    .selectDistinct({ motivo: c.motivo })
    .from(c)
    .where(and(eq(c.filialId, filial.id), isNotNull(c.motivo)))
    .orderBy(asc(c.motivo));

  // Nome das praças (cozinha, bar…) — vem do espelho do wizard da loja.
  const areas = await db
    .select({ codigo: schema.areaProducao.codigoExterno, nome: schema.areaProducao.nome })
    .from(schema.areaProducao)
    .where(eq(schema.areaProducao.filialId, filial.id));
  const nomeArea = new Map(areas.map((a) => [a.codigo, a.nome]));

  // A loja já mandou alguma coisa? Se nunca mandou, a lista vazia é sync, não ausência de cancelamento.
  const [{ n: totalFilial }] = await db.select({ n: count() }).from(c).where(eq(c.filialId, filial.id));

  const valorDe = (l: { valor: string | null }) => Number(l.valor ?? 0);
  const total = linhas.reduce((s, l) => s + valorDe(l), 0);
  const produzidos = linhas.filter((l) => jaProduzido(l.statusItem));
  const valorProduzidos = produzidos.reduce((s, l) => s + valorDe(l), 0);
  const pedidosInteiros = linhas.filter((l) => l.tipo === 'pedido').length;
  const porMotivo = agrupar(linhas, (l) => l.motivo || '(sem motivo)', valorDe);
  const porQuem = agrupar(linhas, (l) => l.login || '?', valorDe);
  const porGerente = agrupar(
    linhas.filter((l) => l.gerente && l.gerente !== l.login),
    (l) => l.gerente || '—',
    valorDe,
  );
  const porPraca = agrupar(
    linhas.filter((l) => l.tipo !== 'pedido'),
    (l) => (l.areaCodigo == null ? '(sem praça)' : nomeArea.get(l.areaCodigo) ?? `praça ${l.areaCodigo}`),
    valorDe,
  );

  function href(next: Partial<SP>): string {
    const qs = new URLSearchParams();
    qs.set('filialId', filial.id);
    qs.set('dataIni', next.dataIni ?? dataIni);
    qs.set('dataFim', next.dataFim ?? dataFim);
    const m = next.motivo !== undefined ? next.motivo : motivoSel;
    if (m) qs.set('motivo', m);
    const q = next.quem !== undefined ? next.quem : quemSel;
    if (q) qs.set('quem', q);
    return `/movimento/cancelamentos?${qs.toString()}`;
  }
  const inputCls = 'mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm';
  const labelCls = 'block text-[11px] font-medium uppercase tracking-wide text-slate-500';

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Cancelamentos do caixa</h1>
        <p className="mt-1 text-sm text-slate-600">
          Item ou pedido cancelado no caixa, com o motivo, quem cancelou e quem autorizou.{' '}
          <span className="text-amber-700">Já produzido</span> = o item tinha saído da cozinha antes de
          ser cancelado (custou e não foi vendido).
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/movimento/cancelamentos?filialId=${f.id}&dataIni=${dataIni}&dataFim=${dataFim}`}
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

        {/* KPIs do período filtrado */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Cancelamentos" valor={int(linhas.length)} sub={brl(total)} tom="slate" />
          <Kpi
            label="Já produzidos"
            valor={int(produzidos.length)}
            sub={`${brl(valorProduzidos)} · ${linhas.length ? Math.round((produzidos.length / linhas.length) * 100) : 0}% do total`}
            tom="amber"
          />
          <Kpi label="Pedidos inteiros" valor={int(pedidosInteiros)} sub="cancelados por completo" tom="rose" />
          <Kpi
            label="Motivo mais comum"
            valor={porMotivo[0]?.chave ?? '—'}
            sub={porMotivo[0] ? `${int(porMotivo[0].qtd)} · ${brl(porMotivo[0].valor)}` : ''}
            tom="slate"
            pequeno
          />
        </div>

        {/* Filtros */}
        <form
          action="/movimento/cancelamentos"
          method="GET"
          className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <input type="hidden" name="filialId" value={filial.id} />
          <div>
            <label className={labelCls}>De</label>
            <input type="date" name="dataIni" defaultValue={dataIni} className={`${inputCls} font-mono`} />
          </div>
          <div>
            <label className={labelCls}>Até</label>
            <input type="date" name="dataFim" defaultValue={dataFim} className={`${inputCls} font-mono`} />
          </div>
          <div className="min-w-[220px]">
            <label className={labelCls}>Motivo</label>
            <select name="motivo" defaultValue={motivoSel} className={`${inputCls} w-full`}>
              <option value="">todos</option>
              {motivos.map((m) => (
                <option key={m.motivo ?? ''} value={m.motivo ?? ''}>
                  {m.motivo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Quem cancelou (login)</label>
            <input name="quem" defaultValue={quemSel} placeholder="ex: matheus" className={inputCls} />
          </div>
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            Aplicar
          </button>
          {(motivoSel || quemSel) && (
            <Link
              href={href({ motivo: '', quem: '' })}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              Limpar
            </Link>
          )}
          <div className="ml-auto flex items-center gap-1 text-[11px]">
            <span className="mr-1 uppercase text-slate-500">Atalhos:</span>
            <Link href={href({ dataIni: hoje, dataFim: hoje })} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">Hoje</Link>
            <Link href={href({ dataIni: diasAtrasBr(7), dataFim: hoje })} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">7d</Link>
            <Link href={href({ dataIni: diasAtrasBr(30), dataFim: hoje })} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">30d</Link>
            <Link href={href({ dataIni: hoje.slice(0, 7) + '-01', dataFim: hoje })} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">Este mês</Link>
          </div>
        </form>

        {/* Resumos */}
        {linhas.length > 0 && (
          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <Resumo titulo="Por motivo" grupos={porMotivo} linkDe={(g) => href({ motivo: g.chave === '(sem motivo)' ? '' : g.chave })} />
            <Resumo titulo="Por quem cancelou" grupos={porQuem} linkDe={(g) => href({ quem: g.chave === '?' ? '' : g.chave })} />
            <Resumo titulo="Por praça (cozinha × bar)" grupos={porPraca} vazio="Só pedidos inteiros no período." />
            <Resumo titulo="Autorizado por (gerente)" grupos={porGerente} vazio="Ninguém precisou de autorização — quem cancelou era gerente." />
          </div>
        )}

        {/* Lista */}
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Quando</th>
                <th className="px-4 py-2">Mesa/comanda</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2 text-right">Valor</th>
                <th className="px-4 py-2">Situação do item</th>
                <th className="px-4 py-2">Quem cancelou</th>
                <th className="px-4 py-2">Autorizou</th>
                <th className="px-4 py-2">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-xs text-slate-500">
                    {Number(totalFilial) === 0
                      ? 'A loja ainda não enviou nenhum cancelamento pra nuvem — isso depende do vendas-local atualizado rodando lá.'
                      : 'Nenhum cancelamento nesse filtro.'}
                  </td>
                </tr>
              ) : (
                linhas.map((l) => {
                  const prod = jaProduzido(l.statusItem);
                  return (
                    <tr key={l.id} className={`border-t border-slate-100 ${l.tipo === 'pedido' ? 'bg-rose-50/40' : prod ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">{formatDateTime(l.quando)}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">{l.numero ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-slate-800">
                        {l.nome ?? '—'}
                        {l.tipo === 'pedido' && (
                          <span className="ml-1.5 rounded bg-rose-100 px-1 py-0.5 text-[9px] font-bold text-rose-800">PEDIDO</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-sm text-slate-900">{brl(l.valor)}</td>
                      <td className={`px-4 py-2 text-xs ${prod ? 'font-medium text-amber-700' : 'text-slate-600'}`}>
                        {rotuloStatus(l.statusItem)}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-800">{l.login ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-slate-600">
                        {l.gerente && l.gerente !== l.login ? l.gerente : l.gerente ? 'ele mesmo' : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-700">{l.motivo ?? <span className="text-slate-400">sem motivo</span>}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {linhas.length >= 500 && (
            <p className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-center text-xs text-slate-500">
              Mostrando 500. Refine o período pra ver mais.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function Kpi({
  label,
  valor,
  sub,
  tom,
  pequeno,
}: {
  label: string;
  valor: string;
  sub: string;
  tom: 'slate' | 'amber' | 'rose';
  pequeno?: boolean;
}) {
  const cor = {
    slate: 'border-slate-200 bg-white',
    amber: 'border-amber-200 bg-amber-50',
    rose: 'border-rose-200 bg-rose-50',
  }[tom];
  return (
    <div className={`rounded-xl border p-4 ${cor}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">{label}</p>
      <p className={`mt-1 font-bold text-slate-900 ${pequeno ? 'text-base leading-snug' : 'text-2xl'}`}>{valor}</p>
      <p className="text-xs text-slate-700">{sub}</p>
    </div>
  );
}

function Resumo({
  titulo,
  grupos,
  linkDe,
  vazio,
}: {
  titulo: string;
  grupos: Grupo[];
  linkDe?: (g: Grupo) => string;
  vazio?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
      {grupos.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">{vazio ?? '—'}</p>
      ) : (
        <table className="mt-2 w-full text-xs">
          <tbody>
            {grupos.slice(0, 8).map((g) => (
              <tr key={g.chave} className="border-t border-slate-100">
                <td className="py-1.5 pr-2 text-slate-800">
                  {linkDe ? (
                    <Link href={linkDe(g)} className="hover:text-sky-700 hover:underline">{g.chave}</Link>
                  ) : (
                    g.chave
                  )}
                </td>
                <td className="py-1.5 pr-2 text-right font-mono text-slate-600">{int(g.qtd)}</td>
                <td className="py-1.5 text-right font-mono text-slate-900">{brl(g.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
