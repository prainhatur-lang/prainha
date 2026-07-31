'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  cotacaoId: string;
  cotacaoFornecedorId: string;
  telefone: string | null;
  fornecedorNome: string;
  filialNome: string;
  link: string;
  fechaEm: string | null; // ISO
  jaEnviado: boolean;
}

function normTelefone(v: string | null): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) d = '55' + d; // assume Brasil
  return d;
}

function horaBr(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function EnviarWhatsappButton({
  cotacaoId,
  cotacaoFornecedorId,
  telefone,
  fornecedorNome,
  filialNome,
  link,
  fechaEm,
  jaEnviado,
}: Props) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const num = normTelefone(telefone);

  if (!num) {
    return <span className="text-[10px] text-slate-400" title="Cadastre o telefone do fornecedor">sem telefone</span>;
  }

  const prazo = horaBr(fechaEm);
  const primeiroNome = fornecedorNome.split(' ')[0] || 'tudo bem';
  const msg =
    `Olá, ${primeiroNome}! Aqui é do ${filialNome || 'Prainha'}.\n\n` +
    `Estamos cotando alguns itens e gostaríamos do seu melhor preço. ` +
    `É rápido, só preencher por este link:\n${link}\n\n` +
    (prazo ? `⏰ Prazo para responder: até ${prazo} (4h).\n\n` : '') +
    `Obrigado!`;

  const waUrl = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;

  async function enviar() {
    setEnviando(true);
    // Abre o WhatsApp com a mensagem pronta (1 toque pra enviar).
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    // Marca como enviado (best-effort).
    try {
      await fetch(`/api/cotacao/${cotacaoId}/enviar-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cotacaoFornecedorId }),
      });
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
      title={jaEnviado ? 'Já enviado — clique pra reenviar' : 'Abrir WhatsApp com a mensagem pronta'}
    >
      {jaEnviado ? '📲 reenviar' : '📲 WhatsApp'}
    </button>
  );
}
