'use client';

// "Responder avaliação com IA": a pessoa cola a avaliação do TripAdvisor ou do
// Google, a IA escreve a resposta da casa e a pessoa confere, ajusta, copia e
// publica lá. Nada é publicado daqui (o TripAdvisor não tem como um programa
// publicar a resposta do proprietário) e nada é gravado.

import { useState } from 'react';

type Canal = 'tripadvisor' | 'google';

const ONDE_PUBLICAR: Record<Canal, { rotulo: string; url: string }> = {
  tripadvisor: { rotulo: 'Abrir a Central do proprietário do TripAdvisor ↗', url: 'https://www.tripadvisor.com.br/Owners' },
  google: { rotulo: 'Abrir as avaliações no Google ↗', url: 'https://business.google.com/reviews' },
};

export function ResponderComIA({ filiais }: { filiais: Array<{ id: string; nome: string }> }) {
  const [filialId, setFilialId] = useState(filiais[0]?.id ?? '');
  const [canal, setCanal] = useState<Canal>('tripadvisor');
  const [nota, setNota] = useState('');
  const [texto, setTexto] = useState('');
  const [orientacao, setOrientacao] = useState('');
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');
  const [resposta, setResposta] = useState('');
  const [conferir, setConferir] = useState<string[]>([]);
  const [copiado, setCopiado] = useState(false);

  if (filiais.length === 0) return null;

  async function gerar() {
    setGerando(true);
    setErro('');
    setCopiado(false);
    try {
      const r = await fetch('/api/avaliacoes/sugerir-resposta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, canal, nota: nota ? Number(nota) : null, texto, orientacao }),
      });
      const j = (await r.json().catch(() => null)) as
        | { ok?: boolean; resposta?: string; conferir?: string[]; error?: string }
        | null;
      if (!r.ok || !j?.resposta) {
        setErro(j?.error || 'Não consegui escrever agora. Tente de novo.');
        return;
      }
      setResposta(j.resposta);
      setConferir(Array.isArray(j.conferir) ? j.conferir : []);
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setGerando(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(resposta);
      setCopiado(true);
    } catch {
      setErro('Não deu pra copiar sozinho — selecione o texto e copie.');
    }
  }

  const campo =
    'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none';

  return (
    <div id="responder-ia" className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold text-slate-900">✨ Responder avaliação com IA</h3>
      <p className="mt-1 text-xs text-slate-500">
        Abra a avaliação no TripAdvisor ou no Google, copie o que o cliente escreveu e cole aqui. A IA
        escreve a resposta da casa; você confere, ajusta e publica lá — daqui nada é publicado sozinho.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Casa
          <select value={filialId} onChange={(e) => setFilialId(e.target.value)} className={campo}>
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Onde está a avaliação
          <select value={canal} onChange={(e) => setCanal(e.target.value as Canal)} className={campo}>
            <option value="tripadvisor">TripAdvisor</option>
            <option value="google">Google</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Nota que o cliente deu
          <select value={nota} onChange={(e) => setNota(e.target.value)} className={campo}>
            <option value="">não sei</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} ★
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1 text-xs text-slate-600">
        Avaliação do cliente
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="Cole aqui o título e o texto da avaliação"
          className={campo}
        />
      </label>

      <label className="mt-3 flex flex-col gap-1 text-xs text-slate-600">
        O que a casa apurou ou quer dizer (opcional)
        <input
          value={orientacao}
          onChange={(e) => setOrientacao(e.target.value)}
          maxLength={800}
          placeholder="Ex.: já conversamos com a equipe; foi num sábado de casa cheia"
          className={campo}
        />
        <span className="text-[11px] text-slate-400">
          A IA só afirma o que estiver na avaliação ou aqui — ela não sabe o que aconteceu no dia.
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={gerar}
          disabled={gerando || texto.trim().length < 5}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {gerando ? 'Escrevendo…' : resposta ? 'Escrever de novo' : 'Escrever resposta'}
        </button>
        {erro && <span className="text-xs text-rose-700">{erro}</span>}
      </div>

      {resposta && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Rascunho da resposta — pode editar
            <textarea
              value={resposta}
              onChange={(e) => {
                setResposta(e.target.value);
                setCopiado(false);
              }}
              rows={8}
              className={campo}
            />
          </label>

          {conferir.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-semibold">Antes de publicar, confira:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {conferir.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={copiar}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              {copiado ? '✓ Copiado' : 'Copiar resposta'}
            </button>
            <a
              href={ONDE_PUBLICAR[canal].url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-emerald-700 hover:underline"
            >
              {ONDE_PUBLICAR[canal].rotulo}
            </a>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Texto escrito por IA: leia inteiro antes de publicar. No TripAdvisor a resposta ainda passa
            pela análise deles antes de aparecer.
          </p>
        </div>
      )}
    </div>
  );
}
