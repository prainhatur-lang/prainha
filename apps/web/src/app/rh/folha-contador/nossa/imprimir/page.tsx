// Impressão da folha calculada pelo sistema (29/10/2026): resumo, borderô e
// contracheques, igual à impressão da folha do contador, mas com o cálculo
// próprio (ponto + salário do cadastro, lib/rh/folha-mensal.ts). Serve pro
// mês que o contador ainda não lançou. Só leitura: não grava nada.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { brl } from '@/lib/format';
import { hojeBr } from '@/lib/datas';
import { calcularFolhaMensal, type RegimeFolha } from '@/lib/rh/folha-mensal';
import { horasDoMesPorCpf, salarioFamiliaPorCpf } from '@/lib/rh/folha-mensal-dados';
import { proximosFeriados } from '@/lib/reservas/feriados';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { BotaoImprimir } from '../../imprimir/botao';

export const dynamic = 'force-dynamic';

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
const fmtCnpj = (c: string | null) => {
  const d = (c ?? '').replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : c || '';
};
const fmtCpf = (cpf: string | null) => {
  const c = (cpf ?? '').replace(/\D/g, '');
  return c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : cpf || '—';
};
const ref = (n: number) => (n ? n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '');
const ultimoDiaComp = (comp: string) => {
  const [a, m] = comp.split('-').map(Number);
  return `${comp}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

export default async function ImprimirNossaFolhaPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'folha_equipe.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) redirect('/rh/folha-contador');
  const filial = escolhida;

  const mesAtual = hojeBr().slice(0, 7);
  const [aa, mm] = mesAtual.split('-').map(Number);
  const mesPassado = `${mm === 1 ? aa - 1 : aa}-${String(mm === 1 ? 12 : mm - 1).padStart(2, '0')}`;
  const comp = sp.comp && /^\d{4}-\d{2}$/.test(sp.comp) ? sp.comp : mesAtual;
  const comps = [...new Set([mesAtual, mesPassado, comp])].sort().reverse();
  const parte = sp.parte === 'resumo' || sp.parte === 'bordero' || sp.parte === 'contracheques' ? sp.parte : 'tudo';
  const ini = `${comp}-01`;
  const fim = ultimoDiaComp(comp);
  const previa = comp >= mesAtual;

  const todos = await db
    .select()
    .from(schema.funcionario)
    .where(and(eq(schema.funcionario.filialId, filial.id), isNotNull(schema.funcionario.regimeSalarial)));
  const doMes = todos
    .filter(
      (f) =>
        (!f.dataAdmissao || f.dataAdmissao <= fim) &&
        (!f.dataDesligamento || f.dataDesligamento >= ini) &&
        (f.regimeSalarial === 'clt_mensal' || f.regimeSalarial === 'intermitente_hora'),
    )
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const cpfs = [...new Set(doMes.map((f) => f.cpf).filter((c): c is string => !!c))];
  const [horas, feriados, salFamilia] = await Promise.all([
    horasDoMesPorCpf(cpfs, ini, fim),
    proximosFeriados(ini, 31).then((l) => l.map((f) => f.data)),
    salarioFamiliaPorCpf(cpfs, comp),
  ]);

  const semSalario = doMes.filter((f) => !Number(f.salarioBase));
  const linhas = doMes
    .filter((f) => Number(f.salarioBase))
    .map((f) => ({
      f,
      calc: calcularFolhaMensal({
        regime: f.regimeSalarial as RegimeFolha,
        salario: Number(f.salarioBase),
        comp,
        admissao: f.dataAdmissao,
        desligamento: f.dataDesligamento,
        dias: f.cpf ? horas.get(f.cpf) ?? [] : [],
        feriados,
        salarioFamilia: f.cpf ? salFamilia.get(f.cpf) : null,
      }),
    }))
    .filter((l) => l.calc.proventos > 0 || l.calc.avisos.length > 0);

  // Banco/Pix: fornecedor ligado ao funcionário (pelo vínculo ou pelo CPF).
  const ids = linhas.map((l) => l.f.id);
  const contas = ids.length
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
        .where(cpfs.length ? or(inArray(schema.funcionario.id, ids), inArray(schema.funcionario.cpf, cpfs)) : inArray(schema.funcionario.id, ids))
    : [];
  const contaPorId = new Map(contas.map((c) => [c.funcionarioId, c]));
  const contaPorCpf = new Map(contas.filter((c) => c.cpf && (c.bancoConta || c.chavePix)).map((c) => [c.cpf as string, c]));
  const contaDe = (f: (typeof doMes)[number]) => {
    const c = contaPorId.get(f.id);
    return c && (c.bancoConta || c.chavePix) ? c : (f.cpf ? contaPorCpf.get(f.cpf) : undefined) ?? c;
  };

  // Uma seção por empresa de registro (como no PDF do contador).
  const grupos = new Map<string, typeof linhas>();
  for (const l of linhas) {
    const k = `${l.f.cnpjRegistro ?? ''}|${l.f.empresaRegistro ?? ''}`;
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  const soma = (ls: typeof linhas, campo: 'proventos' | 'descontos' | 'liquido' | 'fgts') => ls.reduce((s, l) => s + l.calc[campo], 0);
  const empresaDe = (l: (typeof linhas)[number]) => l.f.empresaRegistro || filial.nome;
  const totLiquido = soma(linhas, 'liquido');

  const mostra = (p: 'resumo' | 'bordero' | 'contracheques') => parte === 'tudo' || parte === p;
  const link = (q: Record<string, string>) =>
    `/rh/folha-contador/nossa/imprimir?${new URLSearchParams({ filialId: filial.id, comp, parte, ...q })}`;
  const Previa = () =>
    previa ? <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">PRÉVIA — o mês ainda não fechou; as horas vão até hoje ({fmtData(hojeBr())}).</p> : null;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <style>{`@media print { @page { size: A4; margin: 10mm; } .quebra { break-before: page; } .sem-quebra { break-inside: avoid; } }`}</style>

      <header className="border-b border-slate-200 bg-slate-50 px-6 py-3 print:hidden">
        <div className="mx-auto max-w-5xl space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/rh/folha-contador/comparar?filialId=${filial.id}&comp=${comp}`} className="text-sm text-blue-600 hover:underline">
              ← Voltar à nossa folha
            </Link>
            <BotaoImprimir />
          </div>
          {filiais.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500">Casa:</span>
              {filiais.map((f) => (
                <a key={f.id} href={`/rh/folha-contador/nossa/imprimir?filialId=${f.id}&comp=${comp}&parte=${parte}`}
                  className={`rounded border px-2 py-0.5 ${f.id === filial.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'}`}>
                  {f.nome}
                </a>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">Competência:</span>
            {comps.map((c) => (
              <a key={c} href={link({ comp: c })}
                className={`rounded border px-2 py-0.5 ${c === comp ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'}`}>
                {nomeComp(c)}
              </a>
            ))}
          </div>
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

      <div className="mx-auto max-w-5xl px-6 py-6 text-[12px] print:max-w-none print:px-0 print:py-0">
        {/* ---------- RESUMO ---------- */}
        {mostra('resumo') && (
          <section>
            <h1 className="text-lg font-bold">Resumo da nossa folha — {nomeComp(comp)}</h1>
            <p className="mb-3 text-slate-600">{filial.nome} · {linhas.length} pessoa(s) · líquido total {brl(totLiquido)} · calculada pelo ponto e pelo salário do cadastro</p>
            <Previa />
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-400 text-left text-[10px] uppercase text-slate-600">
                  <th className="py-1 pr-2">Empresa</th>
                  <th className="py-1 pr-2 text-right">Pessoas</th>
                  <th className="py-1 pr-2 text-right">Proventos</th>
                  <th className="py-1 pr-2 text-right">INSS segurados</th>
                  <th className="py-1 pr-2 text-right">Líquido</th>
                  <th className="py-1 text-right">FGTS</th>
                </tr>
              </thead>
              <tbody>
                {[...grupos.entries()].map(([k, ls]) => (
                  <tr key={k} className="border-b border-slate-200">
                    <td className="py-1 pr-2">
                      <span className="font-medium">{empresaDe(ls[0])}</span>
                      {ls[0].f.cnpjRegistro && <span className="block text-[10px] text-slate-500">{fmtCnpj(ls[0].f.cnpjRegistro)}</span>}
                    </td>
                    <td className="py-1 pr-2 text-right">{ls.length}</td>
                    <td className="py-1 pr-2 text-right">{brl(soma(ls, 'proventos'))}</td>
                    <td className="py-1 pr-2 text-right">{brl(soma(ls, 'descontos'))}</td>
                    <td className="py-1 pr-2 text-right font-semibold">{brl(soma(ls, 'liquido'))}</td>
                    <td className="py-1 text-right">{brl(soma(ls, 'fgts'))}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-400 font-bold">
                  <td className="py-1 pr-2">Total</td>
                  <td className="py-1 pr-2 text-right">{linhas.length}</td>
                  <td className="py-1 pr-2 text-right">{brl(soma(linhas, 'proventos'))}</td>
                  <td className="py-1 pr-2 text-right">{brl(soma(linhas, 'descontos'))}</td>
                  <td className="py-1 pr-2 text-right">{brl(totLiquido)}</td>
                  <td className="py-1 text-right">{brl(soma(linhas, 'fgts'))}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-slate-500">
              Salário-família: cotas da última folha do contador. Fora do cálculo: plano de saúde, ajuda de custo, quebra de caixa, afastamento, rescisão, IRRF, faltas e INSS patronal.
            </p>
            {(semSalario.length > 0 || linhas.some((l) => l.calc.avisos.length)) && (
              <div className="mt-3 rounded border border-slate-300 p-2 text-[11px]">
                <p className="font-semibold">Conferir antes de pagar</p>
                <ul className="mt-1 list-disc pl-4">
                  {semSalario.map((f) => (
                    <li key={f.id}><b>{f.nome}</b>: cadastro sem salário — ficou fora.</li>
                  ))}
                  {linhas.filter((l) => l.calc.avisos.length).map((l) => (
                    <li key={l.f.id}><b>{l.f.nome}</b>: {l.calc.avisos.join(' ')}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* ---------- BORDERÔ ---------- */}
        {mostra('bordero') && (
          <section className={mostra('resumo') ? 'quebra mt-10 print:mt-0' : ''}>
            <h1 className="text-lg font-bold">Borderô de pagamento — {nomeComp(comp)}</h1>
            <p className="mb-3 text-slate-600">{filial.nome} · líquido de cada pessoa pela nossa folha</p>
            <Previa />
            {[...grupos.entries()].map(([k, ls]) => (
              <div key={k} className="mb-5">
                <p className="mb-1 font-semibold">
                  {empresaDe(ls[0])} {ls[0].f.cnpjRegistro && <span className="font-normal text-slate-500">· {fmtCnpj(ls[0].f.cnpjRegistro)}</span>}
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
                    {ls.map(({ f, calc }) => {
                      const c = contaDe(f);
                      return (
                        <tr key={f.id} className="sem-quebra border-b border-slate-200">
                          <td className="py-2 pr-2 font-medium">{f.nome}</td>
                          <td className="py-2 pr-2 font-mono text-[11px]">{fmtCpf(f.cpf)}</td>
                          <td className="py-2 pr-2 text-[11px]">
                            {c && (c.bancoNome || c.bancoConta) && <span className="block">{c.bancoNome ?? '—'} · ag {c.bancoAgencia ?? '—'} · cc {c.bancoConta ?? '—'}</span>}
                            {c?.chavePix && <span className="block">Pix: {c.chavePix}</span>}
                            {!c?.bancoConta && !c?.chavePix && <span className="text-rose-600">sem conta cadastrada</span>}
                          </td>
                          <td className="py-2 pr-2 text-right font-mono font-semibold">{brl(calc.liquido)}</td>
                          <td className="py-2"><div className="mt-3 border-b border-slate-400" /></td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-slate-400 font-bold">
                      <td className="py-1 pr-2" colSpan={3}>Subtotal ({ls.length})</td>
                      <td className="py-1 pr-2 text-right font-mono">{brl(soma(ls, 'liquido'))}</td>
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
          linhas.map(({ f, calc }, i) => {
            const prov = calc.rubricas.filter((r) => r.tipo === 'P');
            const desc_ = calc.rubricas.filter((r) => r.tipo === 'D');
            const primeira = i === 0 && !mostra('resumo') && !mostra('bordero');
            const clt = calc.regime === 'clt_mensal';
            return (
              <section key={f.id} className={`sem-quebra ${primeira ? '' : 'quebra mt-10 print:mt-0'} rounded border border-slate-400 p-4`}>
                <div className="flex items-start justify-between border-b border-slate-400 pb-2">
                  <div>
                    <p className="text-sm font-bold">{f.empresaRegistro || filial.nome}</p>
                    {f.cnpjRegistro && <p className="text-[11px] text-slate-600">CNPJ {fmtCnpj(f.cnpjRegistro)}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">Recibo de pagamento de salário</p>
                    <p className="text-[11px] text-slate-600">Competência {nomeComp(comp)}{previa ? ' · PRÉVIA' : ''}</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-x-3 gap-y-1 border-b border-slate-300 py-2 text-[11px]">
                  <div><span className="text-slate-500">Matrícula</span><br />{f.matriculaFolha ?? '—'}</div>
                  <div className="col-span-2"><span className="text-slate-500">Nome</span><br /><b>{f.nome}</b></div>
                  <div><span className="text-slate-500">CPF</span><br />{fmtCpf(f.cpf)}</div>
                  <div className="col-span-2"><span className="text-slate-500">Cargo</span><br />{f.cargoRegistro || f.cargo || '—'}{f.cbo ? ` · CBO ${f.cbo}` : ''}</div>
                  <div><span className="text-slate-500">Admissão</span><br />{fmtData(f.dataAdmissao)}</div>
                  <div>
                    <span className="text-slate-500">{clt ? 'Mensalista' : 'Intermitente'}</span><br />
                    {brl(Number(f.salarioBase))}{clt ? '' : '/h'} · {ref(calc.horas)} h
                  </div>
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
                    {calc.rubricas.length === 0 && (
                      <tr><td colSpan={5} className="py-2 text-slate-500">Sem valores no mês.</td></tr>
                    )}
                    <tr className="border-t border-slate-400 font-semibold">
                      <td colSpan={3} className="py-1 pr-2 text-right">Totais</td>
                      <td className="py-1 pr-2 text-right">{brl(calc.proventos)}</td>
                      <td className="py-1 text-right">{brl(calc.descontos)}</td>
                    </tr>
                    <tr className="font-bold">
                      <td colSpan={4} className="py-1 pr-2 text-right">Líquido a receber</td>
                      <td className="py-1 text-right text-sm">{brl(calc.liquido)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-2 grid grid-cols-4 gap-2 border-t border-slate-300 pt-2 text-[10px]">
                  <div><span className="text-slate-500">Salário base</span><br />{brl(Number(f.salarioBase))}{clt ? '' : '/h'}</div>
                  <div><span className="text-slate-500">Base INSS</span><br />{brl(calc.baseInss)}</div>
                  <div><span className="text-slate-500">FGTS do mês</span><br />{brl(calc.fgts)}</div>
                  <div><span className="text-slate-500">Dias com ponto</span><br />{calc.diasComPonto}{calc.horasNoturnas ? ` · ${ref(calc.horasNoturnas)} h noturnas` : ''}</div>
                </div>
                {calc.avisos.length > 0 && <p className="mt-1 text-[10px] text-amber-700">{calc.avisos.join(' ')}</p>}
                <div className="mt-8 grid grid-cols-2 gap-8 text-[10px] text-slate-600">
                  <div className="border-t border-slate-500 pt-1 text-center">Data</div>
                  <div className="border-t border-slate-500 pt-1 text-center">Assinatura de {f.nome}</div>
                </div>
              </section>
            );
          })}

        {linhas.length === 0 && (
          <p className="py-10 text-sm text-slate-500">Ninguém com regime e salário no cadastro de {filial.nome} em {nomeComp(comp)}.</p>
        )}
      </div>
    </main>
  );
}
