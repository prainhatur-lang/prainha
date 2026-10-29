// Folha mensal calculada pelo sistema × folha do contador (29/10/2026).
// O dono quer gerar a folha aqui (ponto + salário do cadastro) e conferir
// pessoa a pessoa com a do contador. Só leitura: não grava nada.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { brl } from '@/lib/format';
import { hojeBr } from '@/lib/datas';
import { AppHeader } from '@/components/app-header';
import { calcularFolhaMensal, type FolhaCalc, type RegimeFolha } from '@/lib/rh/folha-mensal';
import { horasDoMesPorCpf, salarioFamiliaPorCpf } from '@/lib/rh/folha-mensal-dados';
import { proximosFeriados } from '@/lib/reservas/feriados';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

interface RubricaFolhaContador {
  codigo: string;
  descricao: string;
  referencia: number;
  valor: number;
  tipo: 'P' | 'D';
}

interface SP {
  filialId?: string;
  comp?: string;
}

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const nomeComp = (comp: string) => {
  const [a, m] = comp.split('-');
  return `${MESES[Number(m)] ?? m}/${a}`;
};
const num = (v: string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const h = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const so11 = (c: string | null | undefined) => {
  const d = (c ?? '').replace(/\D/g, '');
  return d.length === 11 ? d : null;
};
const CODIGOS_NOSSOS = new Set(['998', '825', '8781', '9435', '9438', '9442', '9443', '9441', '25', '219', '205', '250', '854']);
const ultimoDiaComp = (comp: string) => {
  const [a, m] = comp.split('-').map(Number);
  return `${comp}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

function Dif({ v }: { v: number }) {
  if (Math.abs(v) < 0.01) return <span className="text-emerald-600">ok</span>;
  return <span className={v > 0 ? 'font-medium text-amber-700' : 'font-medium text-red-700'}>{v > 0 ? '+' : ''}{brl(v)}</span>;
}

export default async function CompararFolhaPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'folha_equipe.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) redirect('/rh/folha-contador');
  const filial = escolhida;

  const compsContador = (
    await db
      .selectDistinct({ competencia: schema.folhaContador.competencia })
      .from(schema.folhaContador)
      .where(eq(schema.folhaContador.filialId, filial.id))
      .orderBy(desc(schema.folhaContador.competencia))
  ).map((c) => c.competencia);
  const mesAtual = hojeBr().slice(0, 7);
  const [aa, mm] = mesAtual.split('-').map(Number);
  const mesPassado = `${mm === 1 ? aa - 1 : aa}-${String(mm === 1 ? 12 : mm - 1).padStart(2, '0')}`;
  const comps = [...new Set([mesAtual, mesPassado, ...compsContador])].sort().reverse();
  const comp = sp.comp && /^\d{4}-\d{2}$/.test(sp.comp) ? sp.comp : mesAtual;
  const ini = `${comp}-01`;
  const fim = ultimoDiaComp(comp);

  const [contador, nossos] = await Promise.all([
    db
      .select()
      .from(schema.folhaContador)
      .where(and(eq(schema.folhaContador.filialId, filial.id), eq(schema.folhaContador.competencia, comp))),
    db
      .select()
      .from(schema.funcionario)
      .where(and(eq(schema.funcionario.filialId, filial.id), isNotNull(schema.funcionario.regimeSalarial))),
  ]);

  // Quem entra do nosso lado: tem regime + salário e o contrato pega o mês.
  const nossosNoMes = nossos.filter(
    (f) =>
      (!f.dataAdmissao || f.dataAdmissao <= fim) &&
      (!f.dataDesligamento || f.dataDesligamento >= ini) &&
      (f.regimeSalarial === 'clt_mensal' || f.regimeSalarial === 'intermitente_hora'),
  );
  // Linha do contador cujo cadastro está noutra casa: busca pelo CPF.
  const cpfsContador = [...new Set(contador.map((c) => so11(c.cpf)).filter((c): c is string => !!c))];
  const faltam = cpfsContador.filter((c) => !nossosNoMes.some((f) => f.cpf === c));
  const deFora = faltam.length
    ? await db.select().from(schema.funcionario).where(and(inArray(schema.funcionario.cpf, faltam), isNotNull(schema.funcionario.regimeSalarial)))
    : [];
  const cadastroPorCpf = new Map<string, (typeof nossos)[number]>();
  for (const f of [...deFora, ...nossosNoMes]) if (f.cpf) cadastroPorCpf.set(f.cpf, f);

  const cpfs = [...new Set([...nossosNoMes.map((f) => f.cpf).filter((c): c is string => !!c), ...cpfsContador])];
  const [horas, feriados, salFamilia] = await Promise.all([
    horasDoMesPorCpf(cpfs, ini, fim),
    proximosFeriados(ini, 31).then((l) => l.map((f) => f.data)),
    salarioFamiliaPorCpf(cpfs, comp),
  ]);

  interface Linha {
    chave: string;
    nome: string;
    regime: RegimeFolha | null;
    salario: number;
    nosso: FolhaCalc | null;
    fontes: { ponto: number; stelanto: number };
    cont: (typeof contador)[number] | null;
    semCadastro: string | null;
  }
  const linhas: Linha[] = [];
  const usados = new Set<string>();
  const montar = (f: (typeof nossos)[number] | undefined, c: (typeof contador)[number] | null): Linha => {
    const cpf = f?.cpf ?? so11(c?.cpf) ?? '';
    const dias = horas.get(cpf) ?? [];
    const regime = (f?.regimeSalarial as RegimeFolha | undefined) ?? null;
    const salario = num(f?.salarioBase);
    const semCadastro = !f ? 'Sem cadastro com regime no sistema' : !salario ? 'Cadastro sem salário' : null;
    const nosso =
      f && regime && salario
        ? calcularFolhaMensal({
            regime,
            salario,
            comp,
            admissao: f.dataAdmissao ?? c?.dataAdmissao ?? null,
            desligamento: f.dataDesligamento,
            dias,
            feriados,
            salarioFamilia: cpf ? salFamilia.get(cpf) : null,
          })
        : null;
    return {
      chave: cpf || f?.id || c?.id || '',
      nome: f?.nome ?? c?.nome ?? '—',
      regime,
      salario,
      nosso,
      fontes: {
        ponto: dias.filter((d) => d.fonte === 'ponto').length,
        stelanto: dias.filter((d) => d.fonte === 'stelanto').length,
      },
      cont: c,
      semCadastro,
    };
  };
  for (const c of contador) {
    const cpf = so11(c.cpf);
    const f = (cpf ? cadastroPorCpf.get(cpf) : undefined) ?? nossos.find((n) => n.id === c.funcionarioId);
    if (f) usados.add(f.id);
    linhas.push(montar(f, c));
  }
  for (const f of nossosNoMes) if (!usados.has(f.id)) linhas.push(montar(f, null));
  linhas.sort((a, b) => a.nome.localeCompare(b.nome));

  const inssCont = (c: Linha['cont']) =>
    ((c?.rubricas as RubricaFolhaContador[] | null) ?? []).filter((r) => r.codigo === '998' || r.codigo === '825').reduce((s, r) => s + r.valor, 0);
  const horasCont = (c: Linha['cont']) => {
    const rs = (c?.rubricas as RubricaFolhaContador[] | null) ?? [];
    return rs.find((r) => r.codigo === '9435')?.referencia ?? rs.find((r) => r.codigo === '8781')?.referencia ?? null;
  };
  const tot = linhas.reduce(
    (t, l) => ({
      nosso: t.nosso + (l.nosso?.liquido ?? 0),
      cont: t.cont + num(l.cont?.liquido),
      brutoNosso: t.brutoNosso + (l.nosso?.proventos ?? 0),
      brutoCont: t.brutoCont + num(l.cont?.proventos),
    }),
    { nosso: 0, cont: 0, brutoNosso: 0, brutoCont: 0 },
  );
  const soNosso = linhas.filter((l) => !l.cont && l.nosso);
  const soCont = linhas.filter((l) => l.cont && !l.nosso);
  const href = (q: Record<string, string>) => `/rh/folha-contador/comparar?${new URLSearchParams({ filialId: filial.id, comp, ...q })}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Link href={`/rh/folha-contador?filialId=${filial.id}`} className="text-sm text-blue-600 hover:underline">
          ← Folha do contador
        </Link>
        <Link href={`/rh/folha-contador/nossa/imprimir?filialId=${filial.id}&comp=${comp}`} className="ml-4 text-sm text-blue-600 hover:underline">
          🖨 Imprimir nossa folha (resumo, borderô, contracheques)
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">{compsContador.includes(comp) ? 'Nossa folha × contador' : `Nossa folha de ${nomeComp(comp)}`}</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          {filial.nome} · {nomeComp(comp)} · calculada pelo ponto (Stelanto antes do ponto próprio) e pelo salário do cadastro
        </p>

        <div className="mt-4 space-y-2">
          {filiais.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500">Casa:</span>
              {filiais.map((f) => (
                <a key={f.id} href={`/rh/folha-contador/comparar?filialId=${f.id}&comp=${comp}`}
                  className={`rounded border px-2 py-0.5 ${f.id === filial.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'}`}>
                  {f.nome}
                </a>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">Competência:</span>
            {comps.map((c) => (
              <a key={c} href={href({ comp: c })}
                className={`rounded border px-2 py-0.5 ${c === comp ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'}`}>
                {nomeComp(c)}{compsContador.includes(c) ? '' : ' (sem contador)'}
              </a>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Bruto nosso', brl(tot.brutoNosso)],
            ['Bruto contador', compsContador.includes(comp) ? brl(tot.brutoCont) : '—'],
            ['Líquido nosso', brl(tot.nosso)],
            ['Líquido contador', compsContador.includes(comp) ? brl(tot.cont) : '—'],
          ].map(([r, v]) => (
            <div key={r} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="text-[11px] text-slate-500">{r}</div>
              <div className="text-base font-semibold text-slate-900">{v}</div>
            </div>
          ))}
        </div>

        {!compsContador.includes(comp) && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            A folha do contador de {nomeComp(comp)} ainda não foi importada — só a nossa aparece. Importe o PDF dele pra comparar.
            {comp === mesAtual && <> O mês ainda não fechou: as horas vão até a última batida de hoje.</>}
          </p>
        )}
        {(soNosso.length > 0 || soCont.length > 0) && compsContador.includes(comp) && (
          <p className="mt-3 text-xs text-slate-600">
            {soNosso.length > 0 && <>Só na nossa: <b>{soNosso.map((l) => l.nome).join(', ')}</b>. </>}
            {soCont.length > 0 && <>Só no contador: <b>{soCont.map((l) => l.nome).join(', ')}</b>.</>}
          </p>
        )}

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[960px] text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] uppercase text-slate-500">
                <th className="px-2 py-2">Pessoa</th>
                <th className="px-2 py-2 text-right">Horas / dias<br />nosso · contador</th>
                <th className="px-2 py-2 text-right">Bruto<br />nosso · contador</th>
                <th className="px-2 py-2 text-right">INSS<br />nosso · contador</th>
                <th className="px-2 py-2 text-right">Líquido<br />nosso · contador</th>
                <th className="px-2 py-2 text-right">Diferença<br />líquido</th>
                <th className="px-2 py-2 text-right">Diferença sem itens<br />só do contador</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const n = l.nosso;
                const rc = (l.cont?.rubricas as RubricaFolhaContador[] | null) ?? [];
                const soDele = rc.filter((r) => !CODIGOS_NOSSOS.has(r.codigo));
                const clt = l.regime === 'clt_mensal';
                const hc = horasCont(l.cont);
                const extraLiq = soDele.reduce((t, r) => t + (r.tipo === 'P' ? r.valor : -r.valor), 0);
                return (
                  <tr key={l.chave} className="border-b border-slate-100 align-top">
                    <td className="px-2 py-2">
                      <details>
                        <summary className="cursor-pointer font-medium text-slate-900">{l.nome}</summary>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          <div>
                            <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">Nossa</div>
                            {n ? (
                              <table className="w-full">
                                <tbody>
                                  {n.rubricas.map((r) => (
                                    <tr key={r.codigo}>
                                      <td className="pr-2 text-slate-600">{r.codigo} {r.descricao}</td>
                                      <td className="pr-2 text-right text-slate-500">{r.referencia ? h(r.referencia) : ''}</td>
                                      <td className={`text-right ${r.tipo === 'D' ? 'text-red-700' : ''}`}>{brl(r.valor)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <p className="text-slate-500">{l.semCadastro}</p>
                            )}
                            {n && <p className="mt-1 text-[11px] text-slate-500">FGTS {brl(n.fgts)} · {l.fontes.ponto} dia(s) do ponto, {l.fontes.stelanto} do Stelanto</p>}
                            {n?.avisos.map((a) => <p key={a} className="mt-1 text-[11px] text-amber-700">⚠ {a}</p>)}
                          </div>
                          <div>
                            <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">Contador</div>
                            {l.cont ? (
                              <table className="w-full">
                                <tbody>
                                  {rc.map((r, i) => (
                                    <tr key={`${r.codigo}-${i}`} className={CODIGOS_NOSSOS.has(r.codigo) ? '' : 'bg-amber-50'}>
                                      <td className="pr-2 text-slate-600">{r.codigo} {r.descricao}</td>
                                      <td className="pr-2 text-right text-slate-500">{r.referencia ? h(r.referencia) : ''}</td>
                                      <td className={`text-right ${r.tipo === 'D' ? 'text-red-700' : ''}`}>{brl(r.valor)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <p className="text-slate-500">Não está na folha do contador.</p>
                            )}
                            {soDele.length > 0 && <p className="mt-1 text-[11px] text-amber-700">Em amarelo: item que só o contador tem (o sistema não calcula).</p>}
                          </div>
                        </div>
                      </details>
                      <div className="text-[10px] text-slate-500">
                        {l.regime === 'clt_mensal' ? `CLT · ${brl(l.salario)}/mês` : l.regime === 'intermitente_hora' ? `Intermitente · ${brl(l.salario)}/h` : l.cont?.vinculo ?? ''}
                        {soDele.length > 0 && <> · <span className="text-amber-700">+{soDele.length} item(ns) só do contador</span></>}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {n ? (clt ? `${n.diasNoMes} d` : `${h(n.horas)} h`) : '—'} · {hc !== null ? (clt ? `${hc} d` : `${h(hc)} h`) : '—'}
                      {n && clt && n.horasNoturnas > 0 && <div className="text-[10px] text-slate-500">{h(n.horasNoturnas)} h noturnas</div>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{n ? brl(n.proventos) : '—'} · {l.cont ? brl(num(l.cont.proventos)) : '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{n ? brl(n.descontos) : '—'} · {l.cont ? brl(inssCont(l.cont)) : '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{n ? brl(n.liquido) : '—'} · {l.cont ? brl(num(l.cont.liquido)) : '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {n && l.cont ? <Dif v={n.liquido - num(l.cont.liquido)} /> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {n && l.cont ? <Dif v={n.liquido - (num(l.cont.liquido) - extraLiq)} /> : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Diferença positiva = a nossa paga mais que o contador. A última coluna tira da conta os itens que só o contador tem
          (salário-família, rescisão etc.) — o que sobra ali é hora ou regra diferente. O salário-família vem das cotas da última folha do contador. O sistema não calcula plano de saúde, ajuda de custo,
          quebra de caixa, afastamento, rescisão nem IRRF — esses itens aparecem em amarelo no detalhe do contador.
        </p>
      </div>
    </main>
  );
}
