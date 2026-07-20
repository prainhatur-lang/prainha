'use client';

export interface MesaPublica {
  numero: string;
  lugares: number;
  juntavel: boolean;
  livre: boolean;
}

// Mapa clicável de mesas na reserva pública — cliente escolhe a mesa que
// quer (opcional; se não escolher, o servidor aloca a menor mesa livre que
// couber, como já fazia). Nunca mostra nome de outro cliente — só
// livre/ocupada, sem detalhe (privacidade).
export function MapaMesasPublico({
  mesas,
  pessoas,
  selecionada,
  onSelecionar,
}: {
  mesas: MesaPublica[];
  pessoas: number;
  selecionada: string;
  onSelecionar: (numero: string) => void;
}) {
  if (mesas.length === 0) return null;

  return (
    <div className="mt-1.5 rounded-xl border border-[#e7dcc9] bg-[#fdfaf4] p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[#8a7a64]">
        Escolher mesa <span className="font-normal normal-case">(opcional — se não escolher, a gente escolhe pra você)</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {mesas.map((m) => {
          const cabe = m.lugares >= pessoas;
          const clicavel = m.livre && cabe;
          const sel = selecionada === m.numero;
          return (
            <button
              key={m.numero}
              type="button"
              disabled={!clicavel}
              onClick={() => onSelecionar(sel ? '' : m.numero)}
              title={
                !m.livre
                  ? `Mesa ${m.numero} · ocupada`
                  : !cabe
                    ? `Mesa ${m.numero} · ${m.lugares} lugares — não cabe ${pessoas} pessoa(s)`
                    : `Mesa ${m.numero} · ${m.lugares} lugares`
              }
              className={`flex h-14 w-14 flex-col items-center justify-center rounded-lg border text-center transition ${
                sel
                  ? 'border-[#b3411c] bg-[#b3411c] text-white shadow-md'
                  : !m.livre
                    ? 'cursor-not-allowed border-[#e8d5d0] bg-[#f7ecea] text-[#c79a94] opacity-60'
                    : !cabe
                      ? 'cursor-not-allowed border-[#e7dcc9] bg-[#f2ede2] text-[#b3a686] opacity-50'
                      : 'border-[#e7dcc9] bg-white text-[#5a4a38] active:bg-[#fff4e6] hover:border-[#f4b454]'
              }`}
            >
              <span className="text-sm font-bold leading-none">{m.numero}</span>
              <span className="mt-0.5 text-[9px] leading-none opacity-80">{m.lugares} lug</span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[10px] text-[#8a7a64]">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-white ring-1 ring-[#e7dcc9]" /> livre</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-[#f7ecea] ring-1 ring-[#e8d5d0]" /> ocupada</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-[#f2ede2] ring-1 ring-[#e7dcc9]" /> não cabe</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-[#b3411c]" /> escolhida</span>
      </div>
    </div>
  );
}
