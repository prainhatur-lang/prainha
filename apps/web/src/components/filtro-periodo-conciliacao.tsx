// Filtro de período de visualização compartilhado entre as 3 páginas de conciliação
// (Operadora, Recebíveis, Banco). Server component (form GET).

import Link from 'next/link';

interface Props {
  basePath: string; // ex: '/conciliacao/operadora'
  filialId: string;
  /** Data efetiva sendo mostrada (SP > último OK > null) */
  dataInicio: string | null;
  dataFim: string | null;
  /** True quando o user passou explicitamente data na URL (não é default) */
  filtroExplicito: boolean;
  /** Período da última execução OK — mostrado no hint */
  ultimaInicio: string | null;
  ultimaFim: string | null;
  /** Texto do hint default. Default: "Última conciliação:" */
  hintLabel?: string;
}

const fmtBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

export function FiltroPeriodoConciliacao({
  basePath,
  filialId,
  dataInicio,
  dataFim,
  filtroExplicito,
  ultimaInicio,
  ultimaFim,
  hintLabel = 'Última conciliação',
}: Props) {
  const periodoUltima =
    ultimaInicio && ultimaFim ? `${fmtBr(ultimaInicio)} a ${fmtBr(ultimaFim)}` : null;

  return (
    <form
      method="GET"
      className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3"
    >
      <input type="hidden" name="filialId" value={filialId} />
      <div className="min-w-0 flex-1">
        <label className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Filtro de visualização
        </label>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {periodoUltima ? (
            <>
              {hintLabel}: <span className="font-mono">{periodoUltima}</span>
              {filtroExplicito && (
                <span className="ml-1 text-slate-400">
                  · exceções abaixo são do período do filtro
                </span>
              )}
            </>
          ) : (
            'Sem conciliações OK ainda — rode no painel à esquerda primeiro'
          )}
        </p>
      </div>
      <label className="text-xs text-slate-600">
        De
        <input
          type="date"
          name="dataInicio"
          defaultValue={dataInicio ?? ''}
          className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="text-xs text-slate-600">
        Até
        <input
          type="date"
          name="dataFim"
          defaultValue={dataFim ?? ''}
          className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
      </label>
      <button
        type="submit"
        className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
      >
        Filtrar
      </button>
      {filtroExplicito && (
        <Link
          href={`${basePath}?filialId=${filialId}`}
          className="text-xs text-slate-500 hover:text-slate-800"
        >
          Limpar
        </Link>
      )}
    </form>
  );
}
