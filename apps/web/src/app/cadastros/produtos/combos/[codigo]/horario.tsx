'use client';
// QUANDO O COMBO VALE: dias da semana, faixa de hora e calendário.
// Fora da regra o combo é pausado (some do garçom, do caixa e da LIO); dentro
// volta. Clicar num dia do calendário tira o dia (feriado) ou põe um extra.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DIAS_CURTO, agoraBr, diaVale, resumoRegra, valeAgora, type RegraCombo } from '@/lib/combo-horario-regra';

const SEM_REGRA: RegraCombo = {
  ativa: false,
  dias: [1, 2, 3, 4, 5],
  horaInicio: '11:00',
  horaFim: '15:00',
  dataInicio: null,
  dataFim: null,
  datasFora: [],
  datasExtra: [],
};

/** Só os campos da regra (a salva traz estado/autor junto). */
const so = (x: RegraCombo): RegraCombo => ({
  ativa: x.ativa, dias: x.dias, horaInicio: x.horaInicio, horaFim: x.horaFim,
  dataInicio: x.dataInicio, dataFim: x.dataFim, datasFora: x.datasFora, datasExtra: x.datasExtra,
});

function somaDias(ymd: string, n: number) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function HorarioCombo(props: {
  filialId: string;
  varianteCodigo: number;
  regra: (RegraCombo & { estadoAplicado: string | null; aplicadoEm: string | null; atualizadoPor: string | null }) | null;
}) {
  const router = useRouter();
  const [r, setR] = useState<RegraCombo>(() => so(props.regra ?? SEM_REGRA));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [inicioCal, setInicioCal] = useState(0); // semanas a partir de hoje
  const mudou = JSON.stringify(so(r)) !== JSON.stringify(so(props.regra ?? SEM_REGRA));

  const hoje = agoraBr().ymd;
  // 5 semanas, começando no domingo desta semana (+ deslocamento)
  const semanas = useMemo(() => {
    const dom = somaDias(hoje, -new Date(hoje + 'T12:00:00Z').getUTCDay() + inicioCal * 7);
    return Array.from({ length: 5 }, (_, s) => Array.from({ length: 7 }, (_, d) => somaDias(dom, s * 7 + d)));
  }, [hoje, inicioCal]);

  const set = (p: Partial<RegraCombo>) => setR((x) => ({ ...x, ...p }));
  function alternaDiaSemana(d: number) {
    set({ dias: r.dias.includes(d) ? r.dias.filter((x) => x !== d) : [...r.dias, d].sort() });
  }
  function alternaData(ymd: string) {
    const fora = r.datasFora.filter((x) => x !== ymd);
    const extra = r.datasExtra.filter((x) => x !== ymd);
    const base = { ...r, datasFora: fora, datasExtra: extra };
    // o dia, sem exceção nenhuma, valeria? então o clique tira; senão, põe.
    if (diaVale(base, ymd)) {
      set({ datasFora: r.datasFora.includes(ymd) ? fora : [...fora, ymd].sort(), datasExtra: extra });
    } else {
      set({ datasExtra: r.datasExtra.includes(ymd) ? extra : [...extra, ymd].sort(), datasFora: fora });
    }
  }

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const resp = await fetch('/api/cadastros/combos/horario', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId: props.filialId, varianteCodigo: props.varianteCodigo, ...r }),
      });
      const j = (await resp.json().catch(() => null)) as
        | { ok?: boolean; erro?: string; aplicado?: { estado: string; acao: string } | null }
        | null;
      if (!resp.ok || !j?.ok) {
        setMsg(j?.erro ?? 'Não deu para salvar.');
        return;
      }
      const a = j.aplicado;
      setMsg(
        !r.ativa
          ? 'Salvo: sem horário, o combo vale sempre.'
          : a?.estado === 'fora'
            ? 'Salvo. Agora está FORA do horário: o combo sai do garçom, do caixa e da LIO em ~1 min.'
            : 'Salvo. Agora está DENTRO do horário: o combo fica à venda.',
      );
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  const noAr = valeAgora(r);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">⏰ Quando vale</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Fora do horário o combo sai do garçom, do caixa e da maquininha sozinho, e volta quando entra no horário.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={r.ativa} onChange={(e) => set({ ativa: e.target.checked })} />
          tem horário
        </label>
      </div>

      {r.ativa && (
        <div className="mt-4 space-y-4">
          <div>
            <div className="text-xs font-medium uppercase text-slate-500">Dias da semana</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {DIAS_CURTO.map((nome, d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => alternaDiaSemana(d)}
                  className={`w-12 rounded-md border py-1 text-sm ${
                    r.dias.includes(d)
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {nome}
                </button>
              ))}
              <button type="button" onClick={() => set({ dias: [1, 2, 3, 4, 5] })}
                className="ml-2 rounded-md border border-slate-300 px-2 text-xs text-slate-600 hover:bg-slate-50">seg a sex</button>
              <button type="button" onClick={() => set({ dias: [] })}
                className="rounded-md border border-slate-300 px-2 text-xs text-slate-600 hover:bg-slate-50">todos</button>
            </div>
            {r.dias.length === 0 && <p className="mt-1 text-xs text-slate-500">Nenhum marcado = todos os dias.</p>}
          </div>

          <div className="flex flex-wrap gap-6">
            <div>
              <div className="text-xs font-medium uppercase text-slate-500">Horário</div>
              <div className="mt-1 flex items-center gap-2 text-sm">
                das
                <input type="time" value={r.horaInicio ?? ''} onChange={(e) => set({ horaInicio: e.target.value || null })}
                  className="rounded-md border border-slate-300 px-2 py-1" />
                às
                <input type="time" value={r.horaFim ?? ''} onChange={(e) => set({ horaFim: e.target.value || null })}
                  className="rounded-md border border-slate-300 px-2 py-1" />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Em branco = o dia todo. Fim antes do início (ex.: 18:00 às 02:00) passa da meia-noite.
              </p>
            </div>
            <div>
              <div className="text-xs font-medium uppercase text-slate-500">Vigência</div>
              <div className="mt-1 flex items-center gap-2 text-sm">
                de
                <input type="date" value={r.dataInicio ?? ''} onChange={(e) => set({ dataInicio: e.target.value || null })}
                  className="rounded-md border border-slate-300 px-2 py-1" />
                até
                <input type="date" value={r.dataFim ?? ''} onChange={(e) => set({ dataFim: e.target.value || null })}
                  className="rounded-md border border-slate-300 px-2 py-1" />
              </div>
              <p className="mt-1 text-xs text-slate-500">Em branco = sem data pra começar/acabar.</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase text-slate-500">Calendário</div>
              <div className="flex gap-1 text-xs">
                <button type="button" onClick={() => setInicioCal((x) => x - 5)} disabled={inicioCal <= 0}
                  className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40">◀</button>
                <button type="button" onClick={() => setInicioCal(0)}
                  className="rounded border border-slate-300 px-2 py-0.5">hoje</button>
                <button type="button" onClick={() => setInicioCal((x) => x + 5)}
                  className="rounded border border-slate-300 px-2 py-0.5">▶</button>
              </div>
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1 text-center text-xs">
              {DIAS_CURTO.map((d) => <div key={d} className="text-slate-400">{d}</div>)}
              {semanas.flat().map((ymd) => {
                const vale = diaVale(r, ymd);
                const fora = r.datasFora.includes(ymd);
                const extra = r.datasExtra.includes(ymd);
                const passado = ymd < hoje;
                return (
                  <button
                    key={ymd}
                    type="button"
                    disabled={passado}
                    onClick={() => alternaData(ymd)}
                    title={fora ? 'dia tirado — clique pra voltar' : extra ? 'dia extra — clique pra tirar' : vale ? 'vale — clique pra tirar este dia' : 'não vale — clique pra pôr este dia'}
                    className={`rounded-md border py-1.5 ${
                      passado ? 'border-transparent text-slate-300'
                        : vale ? 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                          : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'
                    } ${ymd === hoje ? 'ring-2 ring-slate-900' : ''} ${fora ? 'line-through' : ''}`}
                  >
                    {ymd.slice(8, 10)}/{ymd.slice(5, 7)}
                    {extra && <span className="ml-0.5">+</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Verde = vale. Clique num dia pra tirar (feriado, evento) ou pôr um dia extra. Riscado = tirado; “+” = extra.
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-sm">
        <span className="text-slate-600">{resumoRegra(r)}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${noAr ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
          {noAr ? 'agora: à venda' : 'agora: fora do horário'}
        </span>
        <button
          type="button"
          onClick={salvar}
          disabled={salvando || !mudou}
          className="ml-auto rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {salvando ? 'Salvando…' : 'Salvar horário'}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-slate-700">{msg}</p>}
      {props.regra?.aplicadoEm && (
        <p className="mt-1 text-xs text-slate-400">
          Última virada aplicada: {props.regra.aplicadoEm} ({props.regra.estadoAplicado ?? '—'})
          {props.regra.atualizadoPor ? ` · regra por ${props.regra.atualizadoPor}` : ''}
        </p>
      )}
    </section>
  );
}
