// Grade de um mês com os eventos de cada dia, colorida pelo status
// (lib/eventos-calendario). Componente de servidor: a troca de mês é por link.

import Link from 'next/link';
import { STATUS_EVENTO_CAL, type EventoCalendario, type StatusEventoCal } from '@/lib/eventos-calendario';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "2026-11" → primeiro e último dia do mês. */
export function limitesDoMes(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

export function mesVizinho(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function CalendarioEventos({
  mes,
  hoje,
  eventos,
  nomeCasa,
  hrefMes,
}: {
  mes: string; // YYYY-MM
  hoje: string; // YYYY-MM-DD
  eventos: EventoCalendario[];
  /** Nome curto da casa (só quando a tela mostra mais de uma). */
  nomeCasa?: (filialId: string) => string | null;
  hrefMes: (mes: string) => string;
}) {
  const [a, m] = mes.split('-').map(Number);
  const { ate } = limitesDoMes(mes);
  const diasNoMes = Number(ate.slice(8));
  const primeiroDs = new Date(Date.UTC(a, m - 1, 1)).getUTCDay();

  const porDia = new Map<string, EventoCalendario[]>();
  for (const e of eventos) {
    const l = porDia.get(e.data) ?? [];
    l.push(e);
    porDia.set(e.data, l);
  }
  const contagem = new Map<StatusEventoCal, number>();
  for (const e of eventos) contagem.set(e.status, (contagem.get(e.status) ?? 0) + 1);

  const celulas: Array<string | null> = [
    ...Array.from({ length: primeiroDs }, () => null),
    ...Array.from({ length: diasNoMes }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (celulas.length % 7) celulas.push(null);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Calendário de eventos</h2>
          <p className="text-xs text-slate-500">Orçamentos e pedidos de evento por data, com a situação de cada um</p>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <Link href={hrefMes(mesVizinho(mes, -1))} className="rounded-md border border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-slate-50" aria-label="Mês anterior">
            ‹
          </Link>
          <span className="min-w-[9rem] text-center font-medium capitalize text-slate-800">
            {MESES[m - 1]} {a}
          </span>
          <Link href={hrefMes(mesVizinho(mes, 1))} className="rounded-md border border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-slate-50" aria-label="Próximo mês">
            ›
          </Link>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
        {(Object.keys(STATUS_EVENTO_CAL) as StatusEventoCal[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${STATUS_EVENTO_CAL[s].ponto}`} />
            {STATUS_EVENTO_CAL[s].label}
            {contagem.get(s) ? <b className="text-slate-800">({contagem.get(s)})</b> : null}
          </span>
        ))}
      </div>

      {/* Grade (telas largas) */}
      <div className="mt-3 hidden grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 md:grid">
        {SEMANA.map((s) => (
          <div key={s} className="bg-slate-50 px-2 py-1 text-[11px] font-medium uppercase text-slate-500">
            {s}
          </div>
        ))}
        {celulas.map((d, i) => {
          if (!d) return <div key={`v${i}`} className="min-h-[5.5rem] bg-slate-50/60" />;
          const lista = porDia.get(d) ?? [];
          const passado = d < hoje;
          return (
            <div key={d} className={`min-h-[5.5rem] bg-white p-1 ${passado ? 'opacity-60' : ''}`}>
              <div
                className={`mb-1 text-[11px] ${d === hoje ? 'inline-block rounded-full bg-slate-900 px-1.5 font-semibold text-white' : 'text-slate-500'}`}
              >
                {Number(d.slice(8))}
              </div>
              <div className="space-y-0.5">
                {lista.slice(0, 4).map((e) => (
                  <Link
                    key={e.id}
                    href={e.href}
                    title={`${STATUS_EVENTO_CAL[e.status].label}${e.local ? ` · ${e.local}` : ''}`}
                    className={`block truncate rounded border px-1 py-px text-[10.5px] leading-tight ${STATUS_EVENTO_CAL[e.status].chip}`}
                  >
                    {e.hora ? `${e.hora} ` : ''}
                    {e.cliente}
                    {e.pessoas ? ` · ${e.pessoas}p` : ''}
                    {nomeCasa?.(e.filialId) ? ` · ${nomeCasa(e.filialId)}` : ''}
                  </Link>
                ))}
                {lista.length > 4 && <div className="text-[10px] text-slate-500">+{lista.length - 4}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lista (celular) */}
      <ul className="mt-3 space-y-1 md:hidden">
        {eventos.length === 0 && <li className="text-sm text-slate-500">Nenhum evento neste mês.</li>}
        {eventos.map((e) => (
          <li key={e.id}>
            <Link href={e.href} className={`block rounded border px-2 py-1 text-xs ${STATUS_EVENTO_CAL[e.status].chip}`}>
              <b>{e.data.slice(8)}/{e.data.slice(5, 7)}</b>
              {e.hora ? ` ${e.hora}` : ''} · {e.cliente}
              {e.pessoas ? ` · ${e.pessoas} pessoas` : ''}
              {nomeCasa?.(e.filialId) ? ` · ${nomeCasa(e.filialId)}` : ''} — {STATUS_EVENTO_CAL[e.status].label}
            </Link>
          </li>
        ))}
      </ul>
      {eventos.length === 0 && <p className="mt-2 hidden text-xs text-slate-500 md:block">Nenhum evento neste mês.</p>}
    </div>
  );
}
