// Seção "Escala sugerida" do estudo de equipe (pedido do dono 10/11/2026):
// turnos que cobrem a necessidade hora a hora de cada dia da semana, contra o
// que a casa tem hoje, com a economia estimada. Botão da IA monta com nomes.
// Só sugestão — não grava na escala do mês.

import type { EstudoEquipe } from '@/lib/rh/estudo-equipe';
import { sugerirTurnos, turnoTxt, NOME_SETOR, PASSO_MAX, type SetorEscala } from '@/lib/rh/escala-sugerida';
import { PainelEscala } from './painel-escala';

const n0 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const n1 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const SETORES: SetorEscala[] = ['atend', 'cozinha'];

export function SecaoEscala(props: {
  e: EstudoEquipe;
  filialId: string;
  mes: string;
  meta: number | null;
  metaCoz: number | null;
  min: number | null;
  escala: string | null;
  escalaEm: string | null;
  escalaPor: string | null;
}) {
  const s = sugerirTurnos(props.e);
  const m = s.mes;
  const dif = m.horasSugeridas - m.horasHoje;
  const abertos = s.dias.filter((d) => d.aberto);

  return (
    <section className="mb-8 rounded-lg border border-emerald-200 bg-emerald-50/30 p-4">
      <h2 className="text-base font-semibold text-slate-800">Escala sugerida</h2>
      <p className="mb-3 text-xs text-slate-500">
        Turnos de 4h a 8h que cobrem a necessidade hora a hora (régua acima), andando no máximo {Math.round(PASSO_MAX * 100)}% por hora em relação a hoje.
        É sugestão para conversar com o gerente — <strong>não altera a escala do mês</strong>.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Horas no mês (atend. + cozinha)</div>
          <div className="text-lg font-semibold text-slate-800">
            {n0(m.horasHoje)} → {n0(m.horasSugeridas)} h
          </div>
          <div className="text-xs text-slate-500">
            {dif > 0 ? '+' : ''}
            {n0(dif)} h
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Custo estimado</div>
          <div className={`text-lg font-semibold ${m.economia >= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
            {m.economia >= 0 ? `−${brl(m.economia)}` : `+${brl(-m.economia)}`}
          </div>
          <div className="text-xs text-slate-500">
            {m.economia >= 0 ? 'economia no mês' : 'a mais no mês, pra cobrir a falta'} · hora média {brl(s.custoHora.atend)} / {brl(s.custoHora.cozinha)}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Atendimento: falta coberta</div>
          <div className="text-lg font-semibold text-slate-800">{n0(m.faltaCoberta)} h</div>
          <div className="text-xs text-slate-500">
            horas com menos gente que o necessário{m.faltaRestante > 0.5 ? ` · fica ${n0(m.faltaRestante)} h pro próximo passo` : ''}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Quadro equivalente</div>
          <div className="text-sm font-medium text-slate-800">
            Atend.: {n1(s.quadro.atend.cltEquivalente)} CLT + {n0(s.quadro.atend.horasTurnosCurtos)} h curtas/sem
          </div>
          <div className="text-sm font-medium text-slate-800">
            Cozinha: {n1(s.quadro.cozinha.cltEquivalente)} CLT + {n0(s.quadro.cozinha.horasTurnosCurtos)} h curtas/sem
          </div>
          <div className="text-xs text-slate-500">turno ≥6h ÷ 44h; turno curto = intermitente/diarista</div>
        </div>
      </div>

      <div className="mb-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Dia</th>
              {SETORES.map((st) => (
                <th key={st} className="px-3 py-2 text-left" colSpan={1}>
                  {NOME_SETOR[st]}: turnos sugeridos
                </th>
              ))}
              <th className="px-3 py-2 text-right">Atend. hoje → sug.</th>
              <th className="px-3 py-2 text-right">Falta hoje</th>
              <th className="px-3 py-2 text-right">Cozinha hoje → sug.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {s.dias.map((d) => (
              <tr key={d.dow} className="align-top">
                <td className="px-3 py-1.5 font-medium">{d.nome}</td>
                {d.aberto ? (
                  <>
                    {SETORES.map((st) => (
                      <td key={st} className="px-3 py-1.5 text-xs text-slate-700">
                        {d.turnos
                          .filter((t) => t.setor === st)
                          .map((t) => (
                            <div key={`${t.ini}-${t.fim}`} className="whitespace-nowrap">
                              <span className="font-medium">{t.qtd}×</span> {turnoTxt(t)}{' '}
                              <span className="text-slate-400">
                                ({t.horas}h{t.intervalo ? ' + 1h interv.' : ''})
                              </span>
                            </div>
                          ))}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right">
                      {n0(d.horasHoje.atend)} → {n0(d.horasSugeridas.atend)} h
                    </td>
                    <td className={`px-3 py-1.5 text-right ${d.faltaHoje.atend > 3 ? 'font-medium text-red-600' : 'text-slate-500'}`}>
                      {n0(d.faltaHoje.atend)} h
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {n0(d.horasHoje.cozinha)} → {n0(d.horasSugeridas.cozinha)} h
                    </td>
                  </>
                ) : (
                  <td colSpan={5} className="px-3 py-1.5 text-xs text-slate-400">
                    sem venda no dia típico
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {abertos.length > 0 && (
        <ul className="mb-2 list-disc space-y-0.5 pl-5 text-xs text-slate-500">
          {s.observacoes.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      )}

      <PainelEscala
        filialId={props.filialId}
        mes={props.mes}
        meta={props.meta}
        metaCoz={props.metaCoz}
        min={props.min}
        escala={props.escala}
        escalaEm={props.escalaEm}
        escalaPor={props.escalaPor}
      />
    </section>
  );
}
