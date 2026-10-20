// Encontro de contas mensal das transferências entre casas: por par de casas,
// quanto cada uma recebeu da outra e quem paga a diferença. Desde 14/10/2026
// entra também o boleto de uma casa pago pelo Inter da outra
// (pagamento_entre_casas, lançado em /financeiro/boletos-inter).
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { db, schema } from '@concilia/db';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { hojeBr } from '@/lib/datas';
import { compLabel, previaEncontro } from '@/lib/transferencia';
import { FecharEncontroButton } from './fechar-btn';

export const dynamic = 'force-dynamic';

export default async function EncontroPage(props: { searchParams: Promise<{ comp?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.read');

  const sp = await props.searchParams;
  const hoje = hojeBr();
  // default: mês anterior (o encontro fecha o mês que passou)
  const [hy, hm] = hoje.slice(0, 7).split('-').map(Number) as [number, number];
  const mesPassado = `${hm === 1 ? hy - 1 : hy}-${String(hm === 1 ? 12 : hm - 1).padStart(2, '0')}`;
  const comp = sp.comp && /^\d{4}-\d{2}$/.test(sp.comp) ? sp.comp : mesPassado;
  const [y, m] = comp.split('-').map(Number) as [number, number];
  const compAnt = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
  const compProx = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;

  const pares = await previaEncontro(user.id, comp);
  const nome = new Map(
    (await db.select({ id: schema.filial.id, nome: schema.filial.nome }).from(schema.filial)).map((f) => [f.id, f.nome]),
  );
  const feitos = await db
    .select()
    .from(schema.encontroContas)
    .where(eq(schema.encontroContas.competencia, comp))
    .orderBy(desc(schema.encontroContas.criadoEm));
  // boletos pagos por uma casa pra conta da outra que entram nesse encontro
  const idsPag = pares.flatMap((p) => p.pagamentos);
  const boletos = idsPag.length
    ? await db
        .select()
        .from(schema.pagamentoEntreCasas)
        .where(inArray(schema.pagamentoEntreCasas.id, idsPag))
        .orderBy(asc(schema.pagamentoEntreCasas.data))
    : [];
  // outros meses com coisa em aberto (o encontro mostra um mês por vez)
  const outrosMeses = [
    ...new Set([
      ...(
        await db
          .selectDistinct({ c: schema.transferenciaFilial.competencia })
          .from(schema.transferenciaFilial)
          .where(eq(schema.transferenciaFilial.status, 'ABERTA'))
      ).map((r) => r.c),
      ...(
        await db
          .selectDistinct({ c: schema.pagamentoEntreCasas.competencia })
          .from(schema.pagamentoEntreCasas)
          .where(eq(schema.pagamentoEntreCasas.status, 'ABERTO'))
      ).map((r) => r.c),
    ]),
  ]
    .filter((c) => c !== comp)
    .sort();

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <Link href={`/movimento/transferencias?comp=${comp}`} className="text-sm text-sky-700 hover:underline">
          ← Transferências
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Encontro de contas</h1>
        <p className="mt-1 text-sm text-slate-600">
          Compensa as transferências em aberto de cada par de casas. As contas a pagar das transferências
          são baixadas por compensação e fica uma conta só com a diferença, na casa que deve — essa é
          paga de verdade (Pix/TED) em Contas a pagar. Entram também os boletos de uma casa que o Inter
          da outra pagou (lançados em{' '}
          <Link href="/financeiro/boletos-inter" className="text-sky-700 hover:underline">
            Boletos pagos no Inter
          </Link>
          ): a casa da conta deve pra casa que pagou.
        </p>

        <div className="mt-4 flex items-center gap-3 text-sm">
          <Link href={`/movimento/transferencias/encontro?comp=${compAnt}`} className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50">←</Link>
          <span className="font-semibold text-slate-800">Competência {compLabel(comp)}</span>
          <Link href={`/movimento/transferencias/encontro?comp=${compProx}`} className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50">→</Link>
        </div>
        {outrosMeses.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Também em aberto:{' '}
            {outrosMeses.map((c, i) => (
              <span key={c}>
                {i > 0 && ' · '}
                <Link href={`/movimento/transferencias/encontro?comp=${c}`} className="text-sky-700 hover:underline">
                  {compLabel(c)}
                </Link>
              </span>
            ))}
          </p>
        )}

        <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">Em aberto</h2>
        {pares.length === 0 ? (
          <p className="mt-2 rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
            Nenhuma transferência nem boleto pago pela outra casa em aberto em {compLabel(comp)}.
          </p>
        ) : (
          <>
            <div className="mt-2 space-y-3">
              {pares.map((p) => (
                <div key={`${p.a}|${p.b}`} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <span className="text-slate-500">{nome.get(p.b)} recebeu de {nome.get(p.a)}:</span>{' '}
                      <b>{brl(p.bDeveA)}</b>
                      {p.bDeveAPagamentos > 0 && (
                        <span className="block text-xs text-violet-700">
                          sendo {brl(p.bDeveAPagamentos)} de boletos pagos pela {nome.get(p.a)}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-slate-500">{nome.get(p.a)} recebeu de {nome.get(p.b)}:</span>{' '}
                      <b>{brl(p.aDeveB)}</b>
                      {p.aDeveBPagamentos > 0 && (
                        <span className="block text-xs text-violet-700">
                          sendo {brl(p.aDeveBPagamentos)} de boletos pagos pela {nome.get(p.b)}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mt-3 text-base">
                    {p.devedora ? (
                      <>
                        👉 <b>{nome.get(p.devedora)}</b> paga <b className="text-rose-700">{brl(p.liquido)}</b> pra{' '}
                        <b>{nome.get(p.credora!)}</b>
                      </>
                    ) : (
                      <>✅ Empatou — ninguém deve nada</>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {p.transferencias.length} transferência(s)
                    {p.pagamentos.length > 0 && ` · ${p.pagamentos.length} boleto(s) pago(s) pela outra casa`}
                  </p>
                </div>
              ))}
            </div>
            {boletos.length > 0 && (
              <div className="mt-4 overflow-x-auto rounded-xl border border-violet-200 bg-white">
                <p className="border-b border-violet-100 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-900">
                  Boletos pagos por uma casa pra conta da outra
                </p>
                <table className="w-full text-sm">
                  <tbody>
                    {boletos.map((x) => (
                      <tr key={x.id} className="border-t border-slate-100 first:border-t-0">
                        <td className="px-3 py-2 whitespace-nowrap text-xs">{x.data.split('-').reverse().join('/')}</td>
                        <td className="px-3 py-2 text-xs">
                          {x.contaPagarId ? (
                            <Link href={`/financeiro/conta/${x.contaPagarId}`} className="hover:underline">
                              {x.descricao}
                            </Link>
                          ) : (
                            x.descricao
                          )}
                          <span
                            className={`ml-1.5 rounded px-1 py-0.5 text-[10px] ${
                              x.origem === 'MANUAL' ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {x.origem === 'MANUAL' ? 'lançado na conta' : 'Inter'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                          {nome.get(x.filialDevedoraId)} deve pra {nome.get(x.filialPagadoraId)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">{brl(x.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <FecharEncontroButton competencia={comp} hoje={hoje} />
          </>
        )}

        {feitos.length > 0 && (
          <>
            <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Já fechados</h2>
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <tbody>
                  {feitos.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100 first:border-t-0">
                      <td className="px-3 py-2 whitespace-nowrap">{e.data.split('-').reverse().join('/')}</td>
                      <td className="px-3 py-2">
                        {Number(e.valorLiquido) > 0 ? (
                          <>
                            <b>{nome.get(e.filialDevedoraId)}</b> paga {brl(e.valorLiquido)} pra <b>{nome.get(e.filialCredoraId)}</b>
                          </>
                        ) : (
                          <>
                            {nome.get(e.filialDevedoraId)} × {nome.get(e.filialCredoraId)}: empatou
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        recebeu {brl(e.valorDevedora)} · enviou {brl(e.valorCredora)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {e.contaPagarId && (
                          <Link
                            href={`/financeiro?filialId=${e.filialDevedoraId}`}
                            className="text-xs text-sky-700 hover:underline"
                          >
                            conta a pagar
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
