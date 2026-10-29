'use client';

export function BotaoImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
    >
      🖨 Imprimir / Salvar PDF
    </button>
  );
}
