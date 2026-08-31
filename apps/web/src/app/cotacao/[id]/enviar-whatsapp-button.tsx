'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  cotacaoId: string;
  cotacaoFornecedorId: string;
  fornecedorId: string;
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
  fornecedorId,
  telefone,
  fornecedorNome,
  filialNome,
  link,
  fechaEm,
  jaEnviado,
}: Props) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [pedindoFone, setPedindoFone] = useState(false);
  const [foneNovo, setFoneNovo] = useState('');
  const [salvandoFone, setSalvandoFone] = useState(false);
  const [erroFone, setErroFone] = useState<string | null>(null);
  const num = normTelefone(telefone);

  /** Sem telefone o botão era um beco sem saída: sobrava mandar na mão, e no
   *  pedido seguinte a mesma coisa. Agora pergunta UMA vez e grava no cadastro
   *  do fornecedor — da próxima já sai direto. */
  async function salvarFone() {
    const limpo = normTelefone(foneNovo);
    if (!limpo) {
      setErroFone('número incompleto (com DDD)');
      return;
    }
    setSalvandoFone(true);
    setErroFone(null);
    try {
      const r = await fetch(`/api/fornecedores/${fornecedorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fonePrincipal: foneNovo.trim() }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setErroFone(d.error ?? 'não deu pra salvar');
        return;
      }
      setPedindoFone(false);
      router.refresh();
    } catch (e) {
      setErroFone((e as Error).message);
    } finally {
      setSalvandoFone(false);
    }
  }

  if (!num) {
    if (!pedindoFone) {
      return (
        <button
          type="button"
          onClick={() => setPedindoFone(true)}
          className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-900 hover:bg-amber-100"
          title="Salva no cadastro do fornecedor — só precisa fazer uma vez"
        >
          + WhatsApp
        </button>
      );
    }
    return (
      <div className="flex flex-col items-center gap-1">
        <input
          autoFocus
          value={foneNovo}
          inputMode="tel"
          placeholder="(79) 99999-9999"
          onChange={(e) => setFoneNovo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void salvarFone();
            if (e.key === 'Escape') setPedindoFone(false);
          }}
          className="w-32 rounded border border-slate-300 px-1.5 py-1 text-center text-[11px]"
        />
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => void salvarFone()}
            disabled={salvandoFone}
            className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white disabled:bg-slate-400"
          >
            {salvandoFone ? '…' : 'salvar'}
          </button>
          <button
            type="button"
            onClick={() => setPedindoFone(false)}
            className="rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-600"
          >
            cancelar
          </button>
        </div>
        {erroFone && <span className="text-[10px] text-rose-600">{erroFone}</span>}
      </div>
    );
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
