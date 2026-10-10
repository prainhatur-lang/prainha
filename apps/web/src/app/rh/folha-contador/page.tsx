// Folha do contador — o "Extrato Mensal" que o escritório de contabilidade
// manda, por casa e por competência: quem está registrado, em que empresa,
// com que cargo/salário, o que recebeu no mês e os encargos da empresa.
//
// Só leitura. Os números entram pela importação dos PDFs
// (`pnpm --filter @concilia/db importar:folha-contador`). É outra trilha de
// pagamento, separada da folha semanal de equipe — nada aqui gera conta a
// pagar. A casa é a do DEPARTAMENTO da folha, que pode não ser a casa do
// cadastro da pessoa (a tela avisa).

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  comp?: string;
}

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function nomeComp(comp: string): string {
  const [a, m] = comp.split('-');
  return `${MESES[Number(m)] ?? m}/${a}`;
}

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function fmtCnpj(d: string): string {
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const num = (v: string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

const REGIME_LABEL: Record<string, string> = { clt_mensal: 'CLT mensal', intermitente_hora: 'Intermitente' };

function KPI({ label, valor, sub }: { label: string; valor: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{valor}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function Selo({ cor, children, title }: { cor: 'red' | 'amber' | 'slate'; children: React.ReactNode; title?: string }) {
  const classe =
    cor === 'red'
      ? 'border-red-200 bg-red-50 text-red-700'
      : cor === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span title={title} className={`ml-1.5 inline-block rounded border px-1.5 py-0.5 text-[10px] font-normal ${classe}`}>
      {children}
    </span>
  );
}

export default async function FolhaContadorPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'folha_equipe.read');

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

  const competencias = (
    await db
      .selectDistinct({ competencia: schema.folhaContador.competencia })
      .from(schema.folhaContador)
      .where(eq(schema.folhaContador.filialId, filial.id))
      .orderBy(desc(schema.folhaContador.competencia))
  ).map((c) => c.competencia);
  const comp = sp.comp && competencias.includes(sp.comp) ? sp.comp : competencias[0] ?? null;

  const seletorFilial = filiais.length > 1 && (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-500">Filial:</span>
      {filiais.map((f) => (
        <a
          key={f.id}
          href={`/rh/folha-contador?filialId=${f.id}${comp ? `&comp=${comp}` : ''}`}
          className={`rounded-md border px-3 py-1 text-xs ${f.id === filial.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
        >
          {f.nome}
        </a>
      ))}
    </div>
  );

  if (!comp) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <div className="mx-auto max-w-5xl px-6 py-6">
          <h1 className="text-xl font-semibold text-slate-900">Folha do contador</h1>
          <p className="mt-0.5 text-xs text-slate-500">{filial.nome}</p>
          <div className="mt-4">{seletorFilial}</div>
          <p className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Nenhuma folha do contador gravada pra esta casa ainda.
          </p>
        </div>
      </main>
    );
  }

  const [a, m] = comp.split('-').map(Number);
  const fimComp = `${comp}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;

  const [linhas, resumos, foraDaFolha, emOutraCasa, casas] = await Promise.all([
    db
      .select({
        fc: schema.folhaContador,
        cadFilialId: schema.funcionario.filialId,
        cadCargo: schema.funcionario.cargo,
      })
      .from(schema.folhaContador)
      .leftJoin(schema.funcionario, eq(schema.funcionario.id, schema.folhaContador.funcionarioId))
      .where(and(eq(schema.folhaContador.filialId, filial.id), eq(schema.folhaContador.competencia, comp)))
      .orderBy(asc(schema.folhaContador.empresa), asc(schema.folhaContador.nome)),
    db
      .select()
      .from(schema.folhaContadorResumo)
      .where(and(eq(schema.folhaContadorResumo.filialId, filial.id), eq(schema.folhaContadorResumo.competencia, comp)))
      .orderBy(asc(schema.folhaContadorResumo.empresa)),
    // Ativos da casa, já admitidos na competência, que não vieram em folha
    // nenhuma (de casa nenhuma). A referência de fora vai escrita por extenso:
    // numa consulta de tabela só o Drizzle tira o nome da tabela da coluna e
    // o "id" passaria a ser o da folha.
    db
      .select({
        id: schema.funcionario.id,
        nome: schema.funcionario.nome,
        cargo: schema.funcionario.cargo,
        setor: schema.funcionario.setor,
        regime: schema.funcionario.regimeSalarial,
        admissao: schema.funcionario.dataAdmissao,
      })
      .from(schema.funcionario)
      .where(
        and(
          eq(schema.funcionario.filialId, filial.id),
          eq(schema.funcionario.ativo, true),
          sql`("funcionario"."data_admissao" IS NULL OR "funcionario"."data_admissao" <= ${fimComp})`,
          sql`NOT EXISTS (SELECT 1 FROM folha_contador fc WHERE fc.funcionario_id = "funcionario"."id" AND fc.competencia = ${comp})`,
        ),
      )
      .orderBy(asc(schema.funcionario.nome)),
    // Cadastro nesta casa, folha no departamento de outra.
    db
      .select({
        nome: schema.funcionario.nome,
        casaFolha: schema.folhaContador.filialId,
        cargo: schema.folhaContador.cargo,
      })
      .from(schema.folhaContador)
      .innerJoin(schema.funcionario, eq(schema.funcionario.id, schema.folhaContador.funcionarioId))
      .where(
        and(
          eq(schema.funcionario.filialId, filial.id),
          eq(schema.folhaContador.competencia, comp),
          ne(schema.folhaContador.filialId, filial.id),
        ),
      )
      .orderBy(asc(schema.funcionario.nome)),
    db.select({ id: schema.filial.id, nome: schema.filial.nome }).from(schema.filial),
  ]);
  const nomeCasa = new Map(casas.map((c) => [c.id, c.nome]));

  // Uma seção por PDF (empresa + departamento).
  const chave = (cnpj: string, depto: string | null) => `${cnpj}|${depto ?? ''}`;
  const grupos = new Map<string, typeof linhas>();
  for (const l of linhas) {
    const k = chave(l.fc.cnpj, l.fc.departamento);
    const lista = grupos.get(k) ?? [];
    lista.push(l);
    grupos.set(k, lista);
  }
  const resumoPorChave = new Map(resumos.map((r) => [chave(r.cnpj, r.departamento), r]));

  const tot = {
    pessoas: linhas.length,
    demitidos: linhas.filter((l) => l.fc.demitidoEm).length,
    proventos: linhas.reduce((s, l) => s + num(l.fc.proventos), 0),
    descontos: linhas.reduce((s, l) => s + num(l.fc.descontos), 0),
    liquido: linhas.reduce((s, l) => s + num(l.fc.liquido), 0),
    fgts: resumos.reduce((s, r) => s + num(r.fgts), 0),
    fgtsResc: resumos.reduce((s, r) => s + num(r.fgtsRescisorio), 0),
    patronal: resumos.reduce((s, r) => s + num(r.inssEmpresa) + num(r.inssRat) + num(r.inssTerceiros), 0),
  };
  const foraComRegistro = foraDaFolha.filter((f) => f.regime);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Folha do contador</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {filial.nome} · {nomeComp(comp)} · registro em carteira, o que cada um recebeu no mês e os encargos
          </p>
        </div>

        <div className="mb-5 space-y-2">
          {seletorFilial}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Competência:</span>
            {competencias.map((c) => (
              <a
                key={c}
                href={`/rh/folha-contador?filialId=${filial.id}&comp=${c}`}
                className={`rounded-md border px-2.5 py-1 text-xs ${c === comp ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                {nomeComp(c)}
              </a>
            ))}
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KPI
            label="Na folha"
            valor={String(tot.pessoas)}
            sub={tot.demitidos > 0 ? `${tot.demitidos} demitido${tot.demitidos > 1 ? 's' : ''} no mês` : 'ninguém demitido'}
          />
          <KPI label="Proventos" valor={brl(tot.proventos)} />
          <KPI label="Descontos" valor={brl(tot.descontos)} />
          <KPI label="Líquido" valor={brl(tot.liquido)} sub="fora o pago em rescisão" />
          <KPI label="FGTS" valor={brl(tot.fgts)} sub={tot.fgtsResc > 0 ? `+ ${brl(tot.fgtsResc)} rescisório` : undefined} />
          <KPI label="INSS da empresa" valor={brl(tot.patronal)} sub="empresa + RAT + terceiros" />
        </div>

        <div className="space-y-5">
          {[...grupos.entries()].map(([k, pessoas]) => {
            const p0 = pessoas[0].fc;
            const r = resumoPorChave.get(k);
            return (
              <section key={k} className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-slate-900">
                    {p0.empresa}
                    {p0.departamento && <span className="font-normal text-slate-500"> · departamento {p0.departamento}</span>}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    CNPJ {fmtCnpj(p0.cnpj)}
                    {r && (
                      <>
                        {' '}· {r.empregados} na folha ({r.trabalhando} trabalhando, {r.demitidos} demitido{r.demitidos === 1 ? '' : 's'}) · proventos{' '}
                        {brl(r.proventos)} · líquido {brl(r.liquido)} · FGTS {brl(r.fgts)}
                        {num(r.fgtsRescisorio) > 0 && ` + ${brl(r.fgtsRescisorio)} rescisório`} · INSS dos empregados {brl(r.inssSegurados)}
                        {num(r.inssEmpresa) + num(r.inssRat) + num(r.inssTerceiros) > 0 &&
                          ` · INSS da empresa ${brl(num(r.inssEmpresa) + num(r.inssRat) + num(r.inssTerceiros))}`}
                      </>
                    )}
                  </p>
                </div>

                <div className="hidden grid-cols-12 gap-2 border-b border-slate-100 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:grid">
                  <span className="col-span-5">Nome</span>
                  <span className="col-span-3">Cargo na carteira</span>
                  <span className="col-span-1 text-right">Salário</span>
                  <span className="col-span-1 text-right">Proventos</span>
                  <span className="col-span-1 text-right">Descontos</span>
                  <span className="col-span-1 text-right">Líquido</span>
                </div>

                <div className="divide-y divide-slate-100">
                  {pessoas.map(({ fc, cadFilialId, cadCargo }) => {
                    const intermitente = /intermitente/i.test(fc.vinculo ?? '');
                    const rescisao = fc.rubricas.find((x) => /LIQUIDO RESCIS/i.test(x.descricao));
                    return (
                      <details key={fc.id} className="group">
                        <summary className="grid cursor-pointer list-none grid-cols-2 gap-x-2 gap-y-1 px-4 py-2 text-sm hover:bg-slate-50 sm:grid-cols-12">
                          <span className="col-span-2 font-medium text-slate-900 sm:col-span-5">
                            <span className="mr-1 inline-block text-slate-300 group-open:rotate-90">›</span>
                            {fc.nome}
                            {fc.demitidoEm && <Selo cor="red">demitido {fmtData(fc.demitidoEm)}</Selo>}
                            {!fc.funcionarioId && (
                              <Selo cor="amber" title="O CPF desta pessoa não está no cadastro de funcionários">
                                sem cadastro no RH
                              </Selo>
                            )}
                            {cadFilialId && cadFilialId !== filial.id && (
                              <Selo cor="amber" title="A folha registra nesta casa; o cadastro está em outra">
                                cadastro na {nomeCasa.get(cadFilialId) ?? 'outra casa'}
                              </Selo>
                            )}
                          </span>
                          <span className="col-span-2 text-xs text-slate-600 sm:col-span-3">
                            {fc.cargo ?? '—'}
                            <span className="ml-1 text-[10px] text-slate-400">{intermitente ? 'intermitente' : 'mensal'}</span>
                          </span>
                          <span className="text-xs text-slate-600 sm:col-span-1 sm:text-right">
                            <span className="text-slate-400 sm:hidden">Salário </span>
                            {brl(fc.salario)}
                            {intermitente && <span className="text-[10px] text-slate-400">/h</span>}
                          </span>
                          <span className="text-xs text-slate-600 sm:col-span-1 sm:text-right">
                            <span className="text-slate-400 sm:hidden">Proventos </span>
                            {brl(fc.proventos)}
                          </span>
                          <span className="text-xs text-slate-600 sm:col-span-1 sm:text-right">
                            <span className="text-slate-400 sm:hidden">Descontos </span>
                            {brl(fc.descontos)}
                          </span>
                          <span className="text-xs font-semibold text-slate-900 sm:col-span-1 sm:text-right">
                            <span className="font-normal text-slate-400 sm:hidden">Líquido </span>
                            {brl(fc.liquido)}
                            {rescisao && (
                              <span className="block text-[10px] font-normal text-slate-400">rescisão {brl(rescisao.valor)}</span>
                            )}
                          </span>
                        </summary>

                        <div className="bg-slate-50/60 px-4 pb-3 pt-1 text-xs text-slate-600">
                          <p className="text-[11px] text-slate-500">
                            Código {fc.matricula} · {fc.vinculo ?? '—'} · CBO {fc.cbo ?? '—'} · admissão {fmtData(fc.dataAdmissao)}
                            {fc.horasMes && ` · ${Number(fc.horasMes).toLocaleString('pt-BR')} h/mês`}
                            {cadCargo && ` · função no cadastro: ${cadCargo}`}
                          </p>
                          {fc.demitidoEm && (
                            <p className="mt-0.5 text-[11px] text-red-700">
                              Demitido em {fmtData(fc.demitidoEm)}
                              {fc.motivoDemissao && ` — ${fc.motivoDemissao}`}
                            </p>
                          )}
                          <table className="mt-2 w-full max-w-2xl text-xs">
                            <thead>
                              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                                <th className="py-1 pr-2 font-medium">Rubrica</th>
                                <th className="py-1 pr-2 text-right font-medium">Ref.</th>
                                <th className="py-1 pr-2 text-right font-medium">Provento</th>
                                <th className="py-1 text-right font-medium">Desconto</th>
                              </tr>
                            </thead>
                            <tbody>
                              {fc.rubricas.map((x, i) => (
                                <tr key={i} className="border-t border-slate-100">
                                  <td className="py-1 pr-2">
                                    <span className="text-slate-400">{x.codigo}</span> {x.descricao}
                                  </td>
                                  <td className="py-1 pr-2 text-right text-slate-500">
                                    {x.referencia.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </td>
                                  <td className="py-1 pr-2 text-right">{x.tipo === 'P' ? brl(x.valor) : ''}</td>
                                  <td className="py-1 text-right">{x.tipo === 'D' ? brl(x.valor) : ''}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="mt-2 text-[11px] text-slate-500">
                            Base INSS {brl(fc.baseInss)} · base FGTS {brl(fc.baseFgts)} · FGTS do mês {brl(fc.valorFgts)} · base IRRF{' '}
                            {brl(fc.baseIrrf)}
                          </p>
                        </div>
                      </details>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {emOutraCasa.length > 0 && (
          <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
            <h2 className="text-sm font-semibold text-slate-900">Cadastro aqui, folha em outra casa</h2>
            <ul className="mt-2 space-y-1 text-xs text-slate-700">
              {emOutraCasa.map((p, i) => (
                <li key={i}>
                  {p.nome} — na folha da {nomeCasa.get(p.casaFolha) ?? 'outra casa'}
                  {p.cargo && <span className="text-slate-500"> · {p.cargo}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Ativos fora da folha ({foraDaFolha.length})</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Cadastro ativo nesta casa, admitido até o fim de {nomeComp(comp)}, que não veio em nenhuma folha do contador
            desse mês.
            {foraComRegistro.length > 0 &&
              ` ${foraComRegistro.length} ${foraComRegistro.length === 1 ? 'tem' : 'têm'} registro marcado no cadastro — vale conferir.`}
          </p>
          {foraDaFolha.length === 0 ? (
            <p className="mt-3 text-xs text-slate-400">Ninguém.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="py-1 pr-3 font-medium">Nome</th>
                    <th className="py-1 pr-3 font-medium">Função</th>
                    <th className="py-1 pr-3 font-medium">Setor</th>
                    <th className="py-1 pr-3 font-medium">Registro no cadastro</th>
                    <th className="py-1 font-medium">Admissão</th>
                  </tr>
                </thead>
                <tbody>
                  {foraDaFolha.map((f) => (
                    <tr key={f.id} className="border-t border-slate-100">
                      <td className="py-1.5 pr-3 font-medium text-slate-900">{f.nome}</td>
                      <td className="py-1.5 pr-3 text-slate-600">{f.cargo ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-slate-600">{f.setor ?? '—'}</td>
                      <td className="py-1.5 pr-3">
                        {f.regime ? (
                          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">
                            {REGIME_LABEL[f.regime] ?? f.regime}
                          </span>
                        ) : (
                          <span className="text-slate-400">sem registro</span>
                        )}
                      </td>
                      <td className="py-1.5 text-slate-600">{fmtData(f.admissao)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
