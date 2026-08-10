'use client';

export function BotaoImprimir() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
    >
      🖨 Imprimir 2ª via
    </button>
  );
}
