'use client';

// LIGA/DESLIGA o controle de estoque DO NOSSO SISTEMA.
//
// A flag sempre existiu no banco (produto.controla_estoque) e é ela que o
// motor de baixa consulta — mas não havia como mexer pela tela: quem nascia
// desmarcado vendia sem baixar nada e ninguém via. No Consumer isso é um
// check no cadastro; aqui é este botão.
//
// Produto COM receita não precisa controlar estoque próprio: quem tem saldo é
// o insumo (regra da casa). Por isso o aviso quando os dois estão ligados.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ControleEstoque({
  produtoId,
  ativo,
  temFicha,
}: {
  produtoId: string;
  ativo: boolean;
  temFicha: boolean;
}) {
  const router = useRouter();
  const [ligado, setLigado] = useState(ativo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function alternar() {
    if (salvando) return;
    const novo = !ligado;
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/produtos/${produtoId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ controlaEstoque: novo }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setLigado(novo);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={alternar}
        disabled={salvando}
        title={
          ligado
            ? 'Baixa estoque deste produto a cada venda. Clique pra desligar.'
            : 'Hoje a venda deste produto não baixa nada. Clique pra controlar.'
        }
        className={`rounded-md border px-2 py-0.5 text-[10px] font-medium disabled:opacity-40 ${
          ligado
            ? 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
        }`}
      >
        {salvando ? '…' : ligado ? '📦 controla estoque' : 'sem controle de estoque'}
      </button>
      {ligado && temFicha && (
        <span
          className="rounded bg-amber-100 px-1 py-0.5 text-[9px] text-amber-800"
          title="Com receita, a baixa cai nos insumos — o saldo deste produto não anda."
        >
          tem receita: quem baixa é o insumo
        </span>
      )}
      {erro && <span className="text-[10px] text-rose-700">{erro}</span>}
    </span>
  );
}
