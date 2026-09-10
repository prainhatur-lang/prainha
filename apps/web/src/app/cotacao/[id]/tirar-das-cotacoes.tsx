'use client';

// Desmarca ativo_compras do cadastro duplicado: ele para de ser convocado nas
// próximas cotações. Não apaga nada — histórico, contas e pedidos continuam.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function TirarDasCotacoes({
  fornecedorId,
  fornecedorNome,
}: {
  fornecedorId: string;
  fornecedorNome: string;
}) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (pronto) return <span className="text-[10px] text-emerald-700">✓ fora das próximas</span>;

  async function tirar() {
    if (!confirm(`Parar de convocar "${fornecedorNome}" nas próximas cotações?\n\nO cadastro continua existindo — só sai da lista de cotação.`)) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/fornecedores/${fornecedorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativoCompras: false }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setErro(d.error ?? `erro ${r.status}`);
        return;
      }
      setPronto(true);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void tirar()}
        disabled={salvando}
        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        title="Tira esse cadastro da lista de cotação (não apaga nada)"
      >
        {salvando ? '…' : '🚫 tirar das próximas'}
      </button>
      {erro && <span className="text-[10px] text-rose-600">⚠ {erro}</span>}
    </>
  );
}
