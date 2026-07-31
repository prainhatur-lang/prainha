'use client';

import { useState } from 'react';

interface Props {
  token: string;
  nomeFilial: string;
  corte: number;
  googleUrl: string | null;
  tripadvisorUrl: string | null;
  origem: string | null;
}

type Fase = 'nota' | 'alta' | 'baixa' | 'enviado';

function Estrela({
  preenchida,
  onClick,
  onHover,
}: {
  preenchida: boolean;
  onClick: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onHover}
      className="px-1 text-5xl leading-none transition-transform hover:scale-110 focus:outline-none"
      aria-label="estrela"
    >
      <span className={preenchida ? 'text-amber-400' : 'text-slate-300'}>★</span>
    </button>
  );
}

export function AvaliarForm({ token, nomeFilial, corte, googleUrl, tripadvisorUrl, origem }: Props) {
  const [fase, setFase] = useState<Fase>('nota');
  const [nota, setNota] = useState(0);
  const [hover, setHover] = useState(0);
  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function registrar(payload: {
    nota: number;
    foiPraGoogle: boolean;
    nome?: string;
    whatsapp?: string;
    comentario?: string;
  }): Promise<boolean> {
    setErro(null);
    try {
      const r = await fetch(`/api/avaliar/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, origem }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.error ?? `Erro ${r.status}`);
        return false;
      }
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    }
  }

  async function escolherNota(n: number) {
    setNota(n);
    if (n >= corte) {
      // Nota alta: registra e direciona pras plataformas de review
      setEnviando(true);
      await registrar({ nota: n, foiPraGoogle: !!googleUrl || !!tripadvisorUrl });
      setEnviando(false);
      setFase('alta');
    } else {
      setFase('baixa');
    }
  }

  async function enviarBaixa(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const ok = await registrar({
      nota,
      foiPraGoogle: false,
      nome: nome.trim() || undefined,
      whatsapp: whatsapp.replace(/\D/g, '') || undefined,
      comentario: comentario.trim() || undefined,
    });
    setEnviando(false);
    if (ok) setFase('enviado');
  }

  const card =
    'rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-center';

  // === Tela 1: escolher nota ===
  if (fase === 'nota') {
    return (
      <div className={card}>
        <h1 className="text-lg font-semibold text-slate-900">{nomeFilial}</h1>
        <p className="mt-1 text-sm text-slate-500">Como foi sua experiência hoje?</p>
        <div className="mt-5 flex justify-center" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Estrela
              key={n}
              preenchida={n <= (hover || nota)}
              onClick={() => escolherNota(n)}
              onHover={() => setHover(n)}
            />
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-400">Toque nas estrelas para avaliar</p>
        {enviando && <p className="mt-2 text-xs text-slate-400">enviando…</p>}
        {erro && <p className="mt-2 text-xs text-rose-600">{erro}</p>}
      </div>
    );
  }

  // === Tela nota alta: convida pro Google ===
  if (fase === 'alta') {
    return (
      <div className={card}>
        <div className="text-5xl">🙏</div>
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Que bom que gostou!</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sua opinião ajuda muito o {nomeFilial}. Que tal deixar uma avaliação pública?
        </p>
        {googleUrl || tripadvisorUrl ? (
          <div className="mt-5 space-y-2">
            {googleUrl && (
              <a
                href={googleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-700"
              >
                ⭐ Avaliar no Google
              </a>
            )}
            {tripadvisorUrl && (
              <a
                href={tripadvisorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                🦉 Avaliar no TripAdvisor
              </a>
            )}
          </div>
        ) : (
          <p className="mt-5 text-sm font-medium text-emerald-600">Obrigado pela avaliação! 💚</p>
        )}
      </div>
    );
  }

  // === Tela nota baixa: coleta contato ===
  if (fase === 'baixa') {
    return (
      <form onSubmit={enviarBaixa} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-center">
          <div className="text-4xl">🙇</div>
          <h1 className="mt-2 text-lg font-semibold text-slate-900">Desculpe não ter sido perfeito</h1>
          <p className="mt-1 text-sm text-slate-500">
            Queremos entender o que aconteceu e resolver. Deixe seu contato que a gente fala com você.
          </p>
        </div>
        <div className="mt-5 space-y-3 text-left">
          <div>
            <label className="text-xs font-medium text-slate-600">O que aconteceu?</label>
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={3}
              placeholder="Conte pra gente…"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Seu nome</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Como te chamamos"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">WhatsApp</label>
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              inputMode="tel"
              placeholder="(00) 00000-0000"
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
          {enviando ? 'Enviando…' : 'Enviar'}
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          Seu contato vai direto pra gestão — não é publicado.
        </p>
      </form>
    );
  }

  // === Tela enviado (apos nota baixa) ===
  return (
    <div className={card}>
      <div className="text-5xl">💚</div>
      <h1 className="mt-3 text-lg font-semibold text-slate-900">Obrigado pelo retorno!</h1>
      <p className="mt-1 text-sm text-slate-500">
        Recebemos sua mensagem e vamos entrar em contato pra resolver. Sua opinião faz a gente melhorar.
      </p>
    </div>
  );
}
