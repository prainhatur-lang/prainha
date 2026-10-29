// Fechamento da folha mensal pra imprimir (29/10/2026): resumo, borderô de
// pagamento e um contracheque por pessoa, da casa e competência escolhidas.
//
// Só leitura — sai da folha do contador importada (folha_contador +
// folha_contador_resumo). Não gera conta a pagar. Banco/Pix do borderô vem do
// fornecedor ligado ao funcionário (pelo vínculo ou pelo CPF).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { brl } from '@/lib/format';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { BotaoImprimir } from './botao';

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
  parte?: string;
}

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const nomeComp = (comp: string) => {
  const [a, m] = comp.split('-');
  return `${MESES[Number(m)] ?? m}/${a}`;
};
const fmtData = (iso: string | null) => {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
};
const fmtCnpj = (d: string) =>
  d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
const fmtCpf = (cpf: string | null) => {
  const c = (cpf ?? '').replace(/\D/g, '');
  return c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : cpf || '—';
};
const num = (v: string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const dinheiro = (v: string | null | undefined) => (v === null || v === undefined ? '—' : brl(Number(v)));
const ref = (n: number) => (n ? n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '');

export default async function ImprimirFolhaMensalPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'folha_equipe.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) redirect('/rh/folha-contador');
  const filial = escolhida;

  const competencias = (
    await db
      .selectDistinct({ competencia: schema.folhaContador.competencia })
      .from(schema.folhaContador)
      .where(eq(schema.folhaContador.filialId, filial.id))
      .orderBy(desc(schema.folhaContador.competencia))
  ).map((c) => c.competencia);
  const comp = sp.comp && competencias.includes(sp.comp) ? sp.comp : competencias[0] ?? null;
  const parte = sp.parte === 'resumo' || sp.parte === 'bordero' || sp.parte === 'contracheques' ? sp.parte : 'tudo';

  const [linhas, resumos] = comp
    ? await Promise.all([
        db
          .select()
          .from(schema.folhaContador)
          .where(and(eq(schema.folhaContador.filialId, filial.id), eq(schema.folhaContador.competencia, comp)))
          .orderBy(asc(schema.folhaContador.empresa), asc(schema.folhaContador.departamento), asc(schema.folhaContador.nome)),
        db
          .select()
          .from(schema.folhaContadorResumo)
          .where(and(eq(schema.folhaContadorResumo.filialId, filial.id), eq(schema.folhaContadorResumo.competencia, comp)))
          .orderBy(asc(schema.folhaContadorResumo.empresa), asc(schema.folhaContadorResumo.departamento)),
      ])
    : [[], []];

  // Banco/Pix: fornecedor do funcionário (pelo vínculo; sem vínculo, pelo CPF).
  const ids = [...new Set(linhas.map((l) => l.funcionarioId).filter((x): x is string => !!x))];
  const cpfs = [...new Set(linhas.map((l) => (l.cpf ?? '').replace(/\D/g, '')).filter((c) => c.length === 11))];
  const contas =
    ids.length || cpfs.length
      ? await db
          .select({
            funcionarioId: schema.funcionario.id,
            cpf: schema.funcionario.cpf,
            bancoNome: schema.fornecedor.bancoNome,
            bancoAgencia: schema.fornecedor.bancoAgencia,
            bancoConta: schema.fornecedor.bancoConta,
            chavePix: schema.fornecedor.chavePix,
          })
          .from(schema.funcionario)
          .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.funcionario.fornecedorId))
          .where(
            ids.length && cpfs.length
              ? or(inArray(schema.funcionario.id, ids), inArray(schema.funcionario.cpf, cpfs))
              : ids.length
                ? inArray(schema.funcionario.id, ids)
                : inArray(schema.funcionario.cpf, cpfs),
          )
      : [];
  const contaPorId = new Map(contas.map((c) => [c.funcionarioId, c]));
  const contaPorCpf = new Map(contas.filter((c) => c.cpf).map((c) => [c.cpf as string, c]));
  const contaDe = (l: (typeof linhas)[number]) =>
    (l.funcionarioId ? contaPorId.get(l.funcionarioId) : undefined) ?? contaPorCpf.get((l.cpf ?? '').replace(/\D/g, ''));

  // Uma seção por empresa + departamento (como vem no PDF do contador).
  const chave = (cnpj: string, depto: string | null) => `${cnpj}|${depto ?? ''}`;
  const grupos = new Map<string, typeof linhas>();
  for (const l of linhas) {
    const k = chave(l.cnpj, l.departamento);
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  const resumoPorChave = new Map(resumos.map((r) => [chave(r.cnpj, r.departamento), r]));
  const totLiquido = linhas.reduce((s, l) => s + num(l.liquido), 0);

  const mostra = (p: 'resumo' | 'bordero' | 'contracheques') => parte === 'tudo' || parte === p;
  const link = (q: Record<string, string>) =>
    `/rh/folha-contador/imprimir?${new URLSearchParams({ filialId: filial.id, ...(comp ? { comp } : {}), parte, ...q })}`;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <style>{`@media print { @page { size: A4; margin: 10mm; } .quebra { break-before: page; } .sem-quebra { break-inside: avoid; } }`}</style>

      <header className="border-b border-slate-200 bg-slate-50 px-6 py-3 print:hidden">
        <div className="mx-auto max-w-5xl space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/rh/folha-contador?filialId=${filial.id}${comp ? `&comp=${comp}` : ''}`} className="text-sm text-blue-600 hover:underline">
              ← Voltar à folha do contador
            </Link>
            <BotaoImprimir />
          </div>
          {filiais.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500">Casa:</span>
              {filiais.map((f) => (
                <a key={f.id} href={`/rh/folha-contador/imprimir?filialId=${f.id}${comp ? `&comp=${comp}` : ''}&parte=${parte}`}
                  className={`rounded border px-2 py-0.5 ${f.id === filial.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'}`}>
                  {f.nome}
                </a>
              ))}
            </div>
          )}
          {competencias.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500">Competência:</span>
              {competencias.map((c) => (
                <a key={c} href={link({ comp: c })}
                  className={`rounded border px-2 py-0.5 ${c === comp ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'}`}>
                  {nomeComp(c)}
                </a>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">Imprimir:</span>
            {([['tudo', 'Tudo'], ['resumo', 'Resumo'], ['bordero', 'Borderô'], ['contracheques', 'Contracheques']] as const).map(([p, rot]) => (
              <a key={p} href={link({ parte: p })}
                className={`rounded border px-2 py-0.5 ${p === parte ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'}`}>
                {rot}
              </a>
            ))}
          </div>
        </div>
      </header>

      {!comp ? (
        <p className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-500">
          Nenhuma folha do contador importada pra {filial.nome} ainda.
        </p>
      ) : (
        <div className="mx-auto max-w-5xl px-6 py-6 text-[12px] print:max-w-none print:px-0 print:py-0">
          {/* ---------- RESUMO ---------- */}
          {mostra('resumo') && (
            <section>
              <h1 className="text-lg font-bold">Resumo da folha — {nomeComp(comp)}</h1>
              <p className="mb-3 text-slate-600">{filial.nome} · {linhas.length} pessoa(s) · líquido total {brl(totLiquido)}</p>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-400 text-left text-[10px] uppercase text-slate-600">
                    <th className="py-1 pr-2">Empresa / departamento</th>
                    <th className="py-1 pr-2 text-right">Pessoas</th>
                    <th className="py-1 pr-2 text-right">Proventos</th>
                    <th className="py-1 pr-2 text-right">Descontos</th>
                    <th className="py-1 pr-2 text-right">Líquido</th>
                    <th className="py-1 pr-2 text-right">INSS segurados</th>
                    <th className="py-1 pr-2 text-right">INSS empresa+RAT+terc.</th>
                    <th className="py-1 pr-2 text-right">FGTS</th>
                    <th className="py-1 text-right">IRRF</th>
                  </tr>
                </thead>
                <tbody>
                  {[...grupos.entries()].map(([k, ls]) => {
                    const r = resumoPorChave.get(k);
                    const prov = ls.reduce((s, l) => s + num(l.proventos), 0);
                    const desc_ = ls.reduce((s, l) => s + num(l.descontos), 0);
                    const liq = ls.reduce((s, l) => s + num(l.liquido), 0);
                    const patronal = r && (r.inssEmpresa !== null || r.inssRat !== null || r.inssTerceiros !== null)
                      ? brl(num(r.inssEmpresa) + num(r.inssRat) + num(r.inssTerceiros))
                      : '—';
                    return (
                      <tr key={k} className="border-b border-slate-200">
                        <td className="py-1 pr-2">
                          <span className="font-medium">{ls[0].empresa}</span>
                          <span className="block text-[10px] text-slate-500">{fmtCnpj(ls[0].cnpj)}{ls[0].departamento ? ` · ${ls[0].departamento}` : ''}</span>
                        </td>
                        <td className="py-1 pr-2 text-right">{ls.length}</td>
                        <td className="py-1 pr-2 text-right">{brl(prov)}</td>
                        <td className="py-1 pr-2 text-right">{brl(desc_)}</td>
                        <td className="py-1 pr-2 text-right font-semibold">{brl(liq)}</td>
                        <td className="py-1 pr-2 text-right">{dinheiro(r?.inssSegurados)}</td>
                        <td className="py-1 pr-2 text-right">{patronal}</td>
                        <td className="py-1 pr-2 text-right">
                          {dinheiro(r?.fgts)}
                          {r && num(r.fgtsRescisorio) > 0 && <span className="block text-[10px] text-slate-500">+ resc. {brl(num(r.fgtsRescisorio))}</span>}
                        </td>
                        <td className="py-1 text-right">{dinheiro(r?.irrf)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-slate-400 font-bold">
                    <td className="py-1 pr-2">Total</td>
                    <td className="py-1 pr-2 text-right">{linhas.length}</td>
                    <td className="py-1 pr-2 text-right">{brl(linhas.reduce((s, l) => s + num(l.proventos), 0))}</td>
                    <td className="py-1 pr-2 text-right">{brl(linhas.reduce((s, l) => s + num(l.descontos), 0))}</td>
                    <td className="py-1 pr-2 text-right">{brl(totLiquido)}</td>
                    <td className="py-1 pr-2 text-right">{brl(resumos.reduce((s, r) => s + num(r.inssSegurados), 0))}</td>
                    <td className="py-1 pr-2 text-right">{brl(resumos.reduce((s, r) => s + num(r.inssEmpresa) + num(r.inssRat) + num(r.inssTerceiros), 0))}</td>
                    <td className="py-1 pr-2 text-right">{brl(resumos.reduce((s, r) => s + num(r.fgts) + num(r.fgtsRescisorio), 0))}</td>
                    <td className="py-1 text-right">{brl(resumos.reduce((s, r) => s + num(r.irrf), 0))}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-slate-500">“—” = o PDF do contador não traz esse valor pra essa empresa.</p>
            </section>
          )}

          {/* ---------- BORDERÔ ---------- */}
          {mostra('bordero') && (
            <section className={mostra('resumo') ? 'quebra mt-10 print:mt-0' : ''}>
              <h1 className="text-lg font-bold">Borderô de pagamento — {nomeComp(comp)}</h1>
              <p className="mb-3 text-slate-600">{filial.nome} · líquido de cada pessoa</p>
              {[...grupos.entries()].map(([k, ls]) => (
                <div key={k} className="mb-5">
                  <p className="mb-1 font-semibold">
                    {ls[0].empresa} <span className="font-normal text-slate-500">· {fmtCnpj(ls[0].cnpj)}{ls[0].departamento ? ` · ${ls[0].departamento}` : ''}</span>
                  </p>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b-2 border-slate-400 text-left text-[10px] uppercase text-slate-600">
                        <th className="py-1 pr-2">Pessoa</th>
                        <th className="py-1 pr-2">CPF</th>
                        <th className="py-1 pr-2">Banco / ag / conta · Pix</th>
                        <th className="py-1 pr-2 text-right">Líquido</th>
                        <th className="w-40 py-1">Assinatura</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ls.map((l) => {
                        const c = contaDe(l);
                        return (
                          <tr key={l.id} className="sem-quebra border-b border-slate-200">
                            <td className="py-2 pr-2 font-medium">
                              {l.nome}
                              {l.demitidoEm && <span className="block text-[10px] font-normal text-slate-500">demitido {fmtData(l.demitidoEm)}</span>}
                            </td>
                            <td className="py-2 pr-2 font-mono text-[11px]">{fmtCpf(l.cpf)}</td>
                            <td className="py-2 pr-2 text-[11px]">
                              {c && (c.bancoNome || c.bancoConta) && <span className="block">{c.bancoNome ?? '—'} · ag {c.bancoAgencia ?? '—'} · cc {c.bancoConta ?? '—'}</span>}
                              {c?.chavePix && <span className="block">Pix: {c.chavePix}</span>}
                              {!c?.bancoConta && !c?.chavePix && <span className="text-rose-600">sem conta cadastrada</span>}
                            </td>
                            <td className="py-2 pr-2 text-right font-mono font-semibold">{brl(num(l.liquido))}</td>
                            <td className="py-2"><div className="mt-3 border-b border-slate-400" /></td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 border-slate-400 font-bold">
                        <td className="py-1 pr-2" colSpan={3}>Subtotal ({ls.length})</td>
                        <td className="py-1 pr-2 text-right font-mono">{brl(ls.reduce((s, l) => s + num(l.liquido), 0))}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
              <p className="text-sm font-bold">Total do borderô: {brl(totLiquido)} ({linhas.length} pessoa{linhas.length !== 1 ? 's' : ''})</p>
            </section>
          )}

          {/* ---------- CONTRACHEQUES ---------- */}
          {mostra('contracheques') &&
            linhas.map((l, i) => {
              const rub = (l.rubricas ?? []) as RubricaFolhaContador[];
              const prov = rub.filter((r) => r.tipo === 'P');
              const desc_ = rub.filter((r) => r.tipo === 'D');
              const primeira = i === 0 && !mostra('resumo') && !mostra('bordero');
              return (
                <section key={l.id} className={`sem-quebra ${primeira ? '' : 'quebra mt-10 print:mt-0'} rounded border border-slate-400 p-4`}>
                  <div className="flex items-start justify-between border-b border-slate-400 pb-2">
                    <div>
                      <p className="text-sm font-bold">{l.empresa}</p>
                      <p className="text-[11px] text-slate-600">CNPJ {fmtCnpj(l.cnpj)}{l.departamento ? ` · ${l.departamento}` : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">Recibo de pagamento de salário</p>
                      <p className="text-[11px] text-slate-600">Competência {nomeComp(comp)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-x-3 gap-y-1 border-b border-slate-300 py-2 text-[11px]">
                    <div><span className="text-slate-500">Matrícula</span><br />{l.matricula ?? '—'}</div>
                    <div className="col-span-2"><span className="text-slate-500">Nome</span><br /><b>{l.nome}</b></div>
                    <div><span className="text-slate-500">CPF</span><br />{fmtCpf(l.cpf)}</div>
                    <div className="col-span-2"><span className="text-slate-500">Cargo</span><br />{l.cargo ?? '—'}{l.cbo ? ` · CBO ${l.cbo}` : ''}</div>
                    <div><span className="text-slate-500">Admissão</span><br />{fmtData(l.dataAdmissao)}</div>
                    <div><span className="text-slate-500">{l.vinculo ?? 'Vínculo'}</span><br />{dinheiro(l.salario)}{l.horasMes ? ` · ${ref(num(l.horasMes))} h` : ''}</div>
                  </div>
                  <table className="mt-1 w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-slate-400 text-left text-[10px] uppercase text-slate-600">
                        <th className="py-1 pr-2">Cód.</th>
                        <th className="py-1 pr-2">Descrição</th>
                        <th className="py-1 pr-2 text-right">Ref.</th>
                        <th className="py-1 pr-2 text-right">Proventos</th>
                        <th className="py-1 text-right">Descontos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...prov, ...desc_].map((r, j) => (
                        <tr key={j} className="border-b border-slate-100">
                          <td className="py-0.5 pr-2 font-mono">{r.codigo}</td>
                          <td className="py-0.5 pr-2">{r.descricao}</td>
                          <td className="py-0.5 pr-2 text-right">{ref(r.referencia)}</td>
                          <td className="py-0.5 pr-2 text-right">{r.tipo === 'P' ? brl(r.valor) : ''}</td>
                          <td className="py-0.5 text-right">{r.tipo === 'D' ? brl(r.valor) : ''}</td>
                        </tr>
                      ))}
                      {rub.length === 0 && (
                        <tr><td colSpan={5} className="py-2 text-slate-500">Sem rubricas no PDF do contador.</td></tr>
                      )}
                      <tr className="border-t border-slate-400 font-semibold">
                        <td colSpan={3} className="py-1 pr-2 text-right">Totais</td>
                        <td className="py-1 pr-2 text-right">{dinheiro(l.proventos)}</td>
                        <td className="py-1 text-right">{dinheiro(l.descontos)}</td>
                      </tr>
                      <tr className="font-bold">
                        <td colSpan={4} className="py-1 pr-2 text-right">Líquido a receber</td>
                        <td className="py-1 text-right text-sm">{dinheiro(l.liquido)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="mt-2 grid grid-cols-5 gap-2 border-t border-slate-300 pt-2 text-[10px]">
                    <div><span className="text-slate-500">Salário base</span><br />{dinheiro(l.salario)}</div>
                    <div><span className="text-slate-500">Base INSS</span><br />{dinheiro(l.baseInss)}</div>
                    <div><span className="text-slate-500">Base FGTS</span><br />{dinheiro(l.baseFgts)}</div>
                    <div><span className="text-slate-500">FGTS do mês</span><br />{dinheiro(l.valorFgts)}</div>
                    <div><span className="text-slate-500">Base IRRF</span><br />{dinheiro(l.baseIrrf)}</div>
                  </div>
                  {l.demitidoEm && (
                    <p className="mt-1 text-[10px] text-slate-600">Demitido em {fmtData(l.demitidoEm)}{l.motivoDemissao ? ` · ${l.motivoDemissao}` : ''}</p>
                  )}
                  <div className="mt-8 grid grid-cols-2 gap-8 text-[10px] text-slate-600">
                    <div className="border-t border-slate-500 pt-1 text-center">Data</div>
                    <div className="border-t border-slate-500 pt-1 text-center">Assinatura de {l.nome}</div>
                  </div>
                </section>
              );
            })}
        </div>
      )}
    </main>
  );
}
