'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  pedidoId: string;
  telefone: string | null;
  mensagem: string; // resumo pronto do pedido
  jaEnviado: boolean;
}

function normTelefone(v: string | null): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) d = '55' + d;
  return d;
}

export function EnviarPedidoButton({ pedidoId, telefone, mensagem, jaEnviado }: Props) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const num = normTelefone(telefone);

  if (!num) {
    return <span className="text-[10px] text-slate-400" title="Cadastre o telefone do fornecedor">sem telefone</span>;
  }

  const waUrl = `https://wa.me/${num}?text=${encodeURIComponent(mensagem)}`;

  async function enviar() {
    setEnviando(true);
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    try {
      await fetch(`/api/compras/pedidos/${pedidoId}/enviar`, { method: 'POST' });
      router.refresh();
    } catch {
      // ignora — o importante é abrir o WhatsApp
    } finally {
      setEnviando(false);
    }
  }

  return (
    <button
      type="button"
      onClick={enviar}
      disabled={enviando}
      className={`rounded px-2 py-0.5 text-xs font-medium ${
        jaEnviado
          ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          : 'bg-emerald-600 text-white hover:bg-emerald-700'
      } disabled:opacity-50`}
      title={jaEnviado ? 'Já enviado — clique pra reenviar' : 'Abrir WhatsApp com o pedido pronto'}
    >
      {jaEnviado ? '📲 reenviar' : '📲 Enviar pedido'}
    </button>
  );
}
