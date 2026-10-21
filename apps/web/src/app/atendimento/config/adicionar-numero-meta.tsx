'use client';

// "Adicionar número de WhatsApp" desta casa (20/10, Prainha Mar): põe o número
// na conta da Meta e já pede o código por SMS. O resto (digitar o código e o
// PIN) aparece no painel do número, logo acima, depois de recarregar.

import { useState } from 'react';

export function AdicionarNumeroMeta({
  filialId,
  nomeCasa,
  onPronto,
}: {
  filialId: string;
  nomeCasa: string;
  onPronto: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [numero, setNumero] = useState('');
  const [nome, setNome] = useState(nomeCasa);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function adicionar() {
    if (enviando) return;
    const certo = window.confirm(
      `Adicionar ${numero} como WhatsApp de "${nome}"?\n\nSe esse número estiver no aplicativo WhatsApp de algum celular, ele sai de lá quando for registrado aqui.`,
    );
    if (!certo) return;
    setEnviando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/atendimento/numeros-meta/adicionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'adicionar', filialId, numero, nome }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg({ ok: false, texto: d?.error ?? 'Falhou.' });
        return;
      }
      setMsg({
        ok: true,
        texto:
          d?.codigo && !d.codigo.ok
            ? `Número adicionado, mas o SMS não saiu: ${d.codigo.erro}. Peça de novo no quadro do número.`
            : 'Número adicionado. Chegou um SMS com o código de 6 dígitos — digite no quadro do número.',
      });
      onPronto();
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
      >
        + Adicionar número de WhatsApp desta casa
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
      <p className="font-medium">Adicionar número de WhatsApp</p>
      <p className="mt-0.5 text-emerald-800">
        O número entra na mesma conta do WhatsApp das outras casas. Vem um código por SMS nesse número; depois você
        escolhe um PIN e ele fica conectado.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          inputMode="tel"
          placeholder="79 99981-2578"
          className="w-40 rounded-md border border-emerald-300 bg-white px-2 py-1 font-mono text-sm text-slate-900"
        />
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome pro cliente"
          className="w-44 rounded-md border border-emerald-300 bg-white px-2 py-1 text-sm text-slate-900"
        />
        <button
          type="button"
          onClick={adicionar}
          disabled={enviando || numero.replace(/\D/g, '').length < 10 || nome.trim().length < 3}
          className="rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {enviando ? 'Adicionando…' : 'Adicionar e mandar SMS'}
        </button>
      </div>
      {msg && <p className={`mt-1.5 font-medium ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.texto}</p>}
    </div>
  );
}
