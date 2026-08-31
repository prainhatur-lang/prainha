'use client';

import { useEffect, useState } from 'react';

interface Props {
  token: string;
  nomeFilial: string;
}

function mesAtualCliente(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function chaveStorage(token: string): string {
  return `clima:${token}`;
}

export function ClimaForm({ token, nomeFilial }: Props) {
  const [jaRespondeuEsteMes, setJaRespondeuEsteMes] = useState(false);
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    try {
      const salvo = localStorage.getItem(chaveStorage(token));
      if (salvo === mesAtualCliente()) setJaRespondeuEsteMes(true);
    } catch {
      // localStorage indisponível (aba privada, etc) — segue sem o aviso.
    }
  }, [token]);

  async function enviar() {
    if (nota === null) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/clima/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nota, comentario: comentario.trim() || undefined }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      try {
        localStorage.setItem(chaveStorage(token), mesAtualCliente());
      } catch {
        // não crítico — só desencoraja duplo-envio acidental.
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
        <div className="text-5xl">💚</div>
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Obrigado!</h1>
        <p className="mt-1 text-sm text-slate-500">Sua resposta é anônima e ajuda a melhorar o dia a dia daqui.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-slate-900">Clima — {nomeFilial}</h1>
        <p className="mt-1 text-sm text-slate-500">
          De 0 a 10, o quanto você recomendaria trabalhar aqui pra um amigo?
        </p>
      </div>

      {jaRespondeuEsteMes && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700">
          Este aparelho já respondeu este mês. Se ainda assim quiser responder de novo, pode enviar.
        </p>
      )}

      <div className="mt-5 grid grid-cols-11 gap-1">
        {Array.from({ length: 11 }, (_, n) => n).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setNota(n)}
            className={`rounded-md py-2 text-xs font-semibold transition-colors ${
              nota === n
                ? n <= 6
                  ? 'bg-rose-500 text-white'
                  : n <= 8
                    ? 'bg-amber-500 text-white'
                    : 'bg-emerald-500 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>Nunca recomendaria</span>
        <span>Recomendaria muito</span>
      </div>

      <div className="mt-4">
        <label className="text-xs font-medium text-slate-600">Quer contar mais alguma coisa? (opcional)</label>
        <textarea
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          rows={3}
          placeholder="Evite detalhes que só uma pessoa poderia saber…"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
        />
      </div>

      {erro && <p className="mt-3 text-center text-xs text-rose-600">{erro}</p>}
      <button
        type="button"
        onClick={enviar}
        disabled={nota === null || enviando}
        className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {enviando ? 'Enviando…' : 'Enviar anonimamente'}
      </button>
      <p className="mt-3 text-center text-[11px] text-slate-400">
        Resposta 100% anônima — não pedimos nome nem qualquer identificação.
      </p>
    </div>
  );
}
