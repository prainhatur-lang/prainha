'use client';

import { useState } from 'react';

interface Props {
  token: string;
  nomeFilial: string;
}

const CATEGORIAS = [
  { valor: 'assedio', label: 'Assédio' },
  { valor: 'seguranca', label: 'Segurança' },
  { valor: 'gestao', label: 'Gestão / liderança' },
  { valor: 'condicoes', label: 'Condições de trabalho' },
  { valor: 'sugestao', label: 'Sugestão' },
  { valor: 'outro', label: 'Outro' },
];

export function CanalForm({ token, nomeFilial }: Props) {
  const [categoria, setCategoria] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!categoria) {
      setErro('Escolha uma categoria.');
      return;
    }
    if (mensagem.trim().length < 10) {
      setErro('Conte um pouco mais (mínimo 10 caracteres).');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/canal/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoria, mensagem: mensagem.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      setEnviado(true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="text-5xl">✅</div>
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Mensagem enviada</h1>
        <p className="mt-1 text-sm text-slate-500">
          Obrigado por falar. Sua mensagem é completamente anônima — não guardamos nenhuma
          informação sobre quem você é.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-slate-900">Canal de escuta — {nomeFilial}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Um espaço seguro pra falar o que precisa ser dito. 100% anônimo — nada aqui identifica
          você.
        </p>
      </div>
      <div className="mt-5 space-y-3 text-left">
        <div>
          <label className="text-xs font-medium text-slate-600">Categoria</label>
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          >
            <option value="">Selecione…</option>
            {CATEGORIAS.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">Sua mensagem</label>
          <textarea
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            rows={6}
            placeholder="Conte com detalhes o que aconteceu…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          />
        </div>
      </div>
      {erro && <p className="mt-3 text-center text-xs text-rose-600">{erro}</p>}
      <button
        type="submit"
        disabled={enviando}
        className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {enviando ? 'Enviando…' : 'Enviar anonimamente'}
      </button>
      <p className="mt-3 text-center text-[11px] text-slate-400">
        Não pedimos nome, telefone ou qualquer identificação. Evite citar detalhes que só uma
        pessoa poderia saber, se quiser se proteger ainda mais.
      </p>
    </form>
  );
}
