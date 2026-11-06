// Nossa folha na tela da folha (dono 06/11/2026: "vamos fazer por nossa folha,
// não pela do contador"). Calculada pelo sistema (ponto + salário do cadastro,
// lib/rh/nossa-folha.ts), com a pessoa na casa do CADASTRO — a mesma conta do
// "Repasse E.B." e do arquivo do Inter. Por isso o líquido daqui bate com o
// repasse. A folha do contador continua no botão "Folha do contador".

import { brl } from '@/lib/format';
import { nossaFolhaDoMes, semSalarioNoMes } from '@/lib/rh/nossa-folha';
import { registroNoMes } from '@/lib/rh/folha-contador-pagamentos';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

function fmtCnpj(d: string): string {
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

const fmtHoras = (h: number) => `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;

function KPI({ label, valor, sub }: { label: string; valor: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{valor}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

type Fora = 'rescisao' | 'diarista' | 'zero' | null;

export async function NossaFolhaView({ filialId, comp }: { filialId: string; comp: string }) {
  const [casa] = await db
    .select({ cnpj: schema.filial.cnpj, nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const casaCnpj = digitos(casa?.cnpj);
  const [linhas, semSalario] = await Promise.all([nossaFolhaDoMes(filialId, comp), semSalarioNoMes(filialId, comp)]);
  const registro = await registroNoMes(filialId, comp, linhas, casaCnpj);

  // Mesmo filtro do repasse (pagamentosDaFolha): saiu no mês vai pela
  // rescisão, diarista recebe pela diária, líquido zero não paga.
  const pessoas = linhas
    .map((l) => {
      let fora: Fora = null;
      if (l.desligamento && l.desligamento.slice(0, 7) === comp) fora = 'rescisao';
      else if (registro.diaristas.has(l.funcionarioId)) fora = 'diarista';
      else if (!(l.liquido > 0)) fora = 'zero';
      const cnpj = digitos(l.cnpjRegistro) || casaCnpj;
      const empresa = l.empresaRegistro || casa?.nome || '';
      return { ...l, fora, cnpj, empresa };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const grupos = new Map<string, typeof pessoas>();
  for (const p of pessoas) {
    const lista = grupos.get(p.cnpj) ?? [];
    lista.push(p);
    grupos.set(p.cnpj, lista);
  }

  const pagos = pessoas.filter((p) => !p.fora);
  const tot = {
    pessoas: pagos.length,
    fora: pessoas.length - pagos.length,
    proventos: pagos.reduce((s, p) => s + p.proventos, 0),
    liquido: pagos.reduce((s, p) => s + p.liquido, 0),
    fgts: pagos.reduce((s, p) => s + p.fgts, 0),
  };

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KPI
          label="Na folha"
          valor={String(tot.pessoas)}
          sub={tot.fora > 0 ? `+ ${tot.fora} fora do pagamento (abaixo)` : 'cadastro desta casa'}
        />
        <KPI label="Proventos" valor={brl(tot.proventos)} />
        <KPI label="Descontos" valor={brl(tot.proventos - tot.liquido)} sub="INSS e outros" />
        <KPI label="Líquido" valor={brl(tot.liquido)} sub="= repasse a pagar" />
        <KPI label="FGTS" valor={brl(tot.fgts)} />
      </div>

      {semSalario.length > 0 && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Sem salário ou valor da hora no cadastro (não entram no cálculo): {semSalario.join(', ')}.
        </p>
      )}

      <div className="space-y-5">
        {[...grupos.entries()].map(([cnpj, lista]) => {
          const dentro = lista.filter((p) => !p.fora);
          return (
            <section key={cnpj} className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">{lista[0]!.empresa}</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  CNPJ {fmtCnpj(cnpj)} · {dentro.length} a pagar · proventos {brl(dentro.reduce((s, p) => s + p.proventos, 0))} ·
                  líquido <b>{brl(dentro.reduce((s, p) => s + p.liquido, 0))}</b> · FGTS {brl(dentro.reduce((s, p) => s + p.fgts, 0))}
                </p>
              </div>

              <div className="hidden grid-cols-12 gap-2 border-b border-slate-100 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:grid">
                <span className="col-span-5">Nome</span>
                <span className="col-span-2">Regime</span>
                <span className="col-span-1 text-right">Horas</span>
                <span className="col-span-1 text-right">Salário</span>
                <span className="col-span-1 text-right">Proventos</span>
                <span className="col-span-1 text-right">Descontos</span>
                <span className="col-span-1 text-right">Líquido</span>
              </div>

              <div className="divide-y divide-slate-100">
                {lista.map((p) => {
                  const inter = p.regime === 'intermitente_hora';
                  return (
                    <div
                      key={p.funcionarioId}
                      className={`grid grid-cols-2 gap-x-2 gap-y-1 px-4 py-2 text-sm sm:grid-cols-12 ${p.fora ? 'opacity-60' : ''}`}
                    >
                      <span className="col-span-2 font-medium text-slate-900 sm:col-span-5">
                        {p.nome}
                        {p.fora === 'rescisao' && (
                          <span className="ml-1.5 inline-block rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-normal text-red-700">
                            saiu {fmtData(p.desligamento)} · paga na rescisão
                          </span>
                        )}
                        {p.fora === 'diarista' && (
                          <span className="ml-1.5 inline-block rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-normal text-amber-800">
                            diarista · recebe pela diária
                          </span>
                        )}
                        {p.fora === 'zero' && (
                          <span className="ml-1.5 inline-block rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-normal text-slate-600">
                            sem valor no mês
                          </span>
                        )}
                      </span>
                      <span className="col-span-2 text-xs text-slate-600">{inter ? 'Intermitente' : 'CLT mensal'}</span>
                      <span className="text-xs text-slate-600 sm:col-span-1 sm:text-right">
                        <span className="text-slate-400 sm:hidden">Horas </span>
                        {p.horas > 0 ? fmtHoras(p.horas) : '—'}
                      </span>
                      <span className="text-xs text-slate-600 sm:col-span-1 sm:text-right">
                        <span className="text-slate-400 sm:hidden">Salário </span>
                        {brl(p.salario)}
                        {inter && <span className="text-[10px] text-slate-400">/h</span>}
                      </span>
                      <span className="text-xs text-slate-600 sm:col-span-1 sm:text-right">
                        <span className="text-slate-400 sm:hidden">Proventos </span>
                        {brl(p.proventos)}
                      </span>
                      <span className="text-xs text-slate-600 sm:col-span-1 sm:text-right">
                        <span className="text-slate-400 sm:hidden">Descontos </span>
                        {brl(p.proventos - p.liquido)}
                      </span>
                      <span className="text-xs font-semibold text-slate-900 sm:col-span-1 sm:text-right">
                        <span className="font-normal text-slate-400 sm:hidden">Líquido </span>
                        {brl(p.liquido)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {pessoas.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Ninguém com regime e salário no cadastro desta casa nesse mês.
          </p>
        )}
      </div>
      <p className="mt-3 text-[11px] text-slate-400">
        Calculada pelo ponto (todas as casas, pelo CPF) e pelo salário do cadastro. Cada pessoa aparece na casa do cadastro.
      </p>
    </>
  );
}
