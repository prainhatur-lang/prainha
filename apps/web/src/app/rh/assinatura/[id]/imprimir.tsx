'use client';

export function BotaoImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 print:hidden"
    >
      🖨️ Imprimir / salvar PDF
    </button>
  );
}
