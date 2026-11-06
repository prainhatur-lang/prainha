'use client';

export function BotaoImprimirPedido() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 print:hidden"
    >
      🖨 Imprimir
    </button>
  );
}
