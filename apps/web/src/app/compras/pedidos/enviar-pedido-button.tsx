'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  pedidoId: string;
  telefone: string | null;
  mensagem: string; // resumo pronto do pedido (fallback wa.me)
  jaEnviado: boolean;
  autoConfigurado?: boolean; // template Meta configurado -> envia sozinho
}

function normTelefone(v: string | null): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) d = '55' + d;
  return d;
}

export function EnviarPedidoButton({ pedidoId, telefone, mensagem, jaEnviado, autoConfigurado }: Props) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const num = normTelefone(telefone);

  if (!num) {
    return <span className="text-[10px] text-slate-400" title="Cadastre o telefone do fornecedor">sem telefone</span>;
  }

  const waUrl = `https://wa.me/${num}?text=${encodeURIComponent(mensagem)}`;

  async function enviar() {
    setEnviando(true);
    setErro(null);
    try {
      if (autoConfigurado) {
        // Envio automático via template (servidor manda sozinho).
        const r = await fetch(`/api/compras/pedidos/${pedidoId}/enviar-auto`, { method: 'POST' });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          setErro(d.error ?? `Erro ${r.status}`);
          return;
        }
      } else {
        // Fallback wa.me (1 toque).
        window.open(waUrl, '_blank', 'noopener,noreferrer');
        await fetch(`/api/compras/pedidos/${pedidoId}/enviar`, { method: 'POST' });
      }
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={enviar}
        disabled={enviando}
        className={`rounded px-2 py-0.5 text-xs font-medium ${
          jaEnviado
            ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            : 'bg-emerald-600 text-white hover:bg-emerald-700'
        } disabled:opacity-50`}
        title={autoConfigurado ? 'Enviar o pedido automático no WhatsApp' : 'Abrir WhatsApp com o pedido pronto'}
      >
        {enviando ? 'Enviando…' : jaEnviado ? '📲 reenviar' : autoConfigurado ? '🚀 Enviar pedido' : '📲 Enviar pedido'}
      </button>
      {erro && <span className="max-w-[140px] break-all text-[10px] text-rose-600">{erro}</span>}
    </div>
  );
}
