'use client';

import { useState } from 'react';

interface Stats {
  total: number;
  media: number;
  pendentes: number;
  altas: number;
}

interface Props {
  filialId: string;
  nome: string;
  token: string | null;
  googleUrl: string | null;
  tripadvisorUrl: string | null;
  corte: number;
  podeConfigurar: boolean;
  stats: Stats | null;
}

export function ConfigFilial({
  filialId,
  nome,
  token,
  googleUrl: googleInicial,
  tripadvisorUrl: tripInicial,
  corte: corteInicial,
  podeConfigurar,
  stats,
}: Props) {
  const [editando, setEditando] = useState(false);
  const [google, setGoogle] = useState(googleInicial ?? '');
  const [trip, setTrip] = useState(tripInicial ?? '');
  const [corte, setCorte] = useState(corteInicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [origem, setOrigem] = useState('');

  // Link base do QR. Usa NEXT_PUBLIC_AVALIACAO_BASE_URL (ex: dominio publico
  // tipo https://avaliar.prainhabar.com) se definido — assim o QR aponta sempre
  // pro dominio certo, nao importa de onde o painel foi aberto. Fallback: origin atual.
  const base =
    process.env.NEXT_PUBLIC_AVALIACAO_BASE_URL?.replace(/\/+$/, '') ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  const linkBase = token ? `${base}/avaliar/${token}` : null;
  const link = linkBase
    ? origem.trim()
      ? `${linkBase}?o=${encodeURIComponent(origem.trim().toLowerCase().replace(/\s+/g, '-'))}`
      : linkBase
    : null;
  const qrSrc = link
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(link)}`
    : null;

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/avaliacoes/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          googleReviewUrl: google,
          tripadvisorReviewUrl: trip,
          notaCorteGoogle: corte,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      setEditando(false);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function copiar() {
    if (link) navigator.clipboard?.writeText(link).catch(() => {});
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-slate-900">{nome}</h3>
          {stats ? (
            <p className="mt-0.5 text-xs text-slate-500">
              ⭐ {stats.media.toFixed(2)} · {stats.total} avaliações ·{' '}
              <span className={stats.pendentes > 0 ? 'font-semibold text-rose-600' : ''}>
                {stats.pendentes} a resolver
              </span>{' '}
              · {stats.altas} no Google
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-400">sem avaliações ainda</p>
          )}
        </div>
        {podeConfigurar && !editando && (
          <button
            onClick={() => setEditando(true)}
            className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            ⚙️ Configurar
          </button>
        )}
      </div>

      {!token && (
        <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
          Link de avaliação ainda não gerado para esta filial. Rode a migration de avaliações.
        </p>
      )}

      {/* Configuracao (google + corte) */}
      {editando && (
        <div className="mt-4 space-y-3 rounded-lg bg-slate-50 p-3">
          <div>
            <label className="text-xs font-medium text-slate-600">Link de avaliação do Google</label>
            <input
              value={google}
              onChange={(e) => setGoogle(e.target.value)}
              placeholder="https://g.page/r/... ou https://share.google/..."
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Link de avaliação do TripAdvisor</label>
            <input
              value={trip}
              onChange={(e) => setTrip(e.target.value)}
              placeholder="https://www.tripadvisor.../UserReviewEdit-..."
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">
              A partir de qual nota direcionar pro Google
            </label>
            <select
              value={corte}
              onChange={(e) => setCorte(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-sky-500 focus:outline-none"
            >
              <option value={4}>Nota 4 e 5 → Google (1-3 ficam internas)</option>
              <option value={5}>Só nota 5 → Google (1-4 ficam internas)</option>
              <option value={3}>Nota 3, 4 e 5 → Google (1-2 ficam internas)</option>
            </select>
          </div>
          {erro && <p className="text-xs text-rose-600">{erro}</p>}
          <div className="flex gap-2">
            <button
              onClick={salvar}
              disabled={salvando}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
            <button
              onClick={() => {
                setEditando(false);
                setGoogle(googleInicial ?? '');
                setTrip(tripInicial ?? '');
                setCorte(corteInicial);
                setErro(null);
              }}
              className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* QR / link */}
      {token && !editando && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="text-xs font-medium text-slate-600">QR / link de avaliação</p>
          <input
            value={origem}
            onChange={(e) => setOrigem(e.target.value)}
            placeholder="mesa 12, garçom joão… (opcional)"
            className="mt-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-sky-500 focus:outline-none"
          />
          <div className="mt-3 flex items-center gap-3">
            {qrSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrSrc}
                alt="QR code de avaliação"
                width={110}
                height={110}
                className="rounded-lg border border-slate-200"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="break-all font-mono text-[10px] text-slate-500">{link}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={copiar}
                  className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                >
                  Copiar link
                </button>
                {qrSrc && (
                  <a
                    href={qrSrc}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                  >
                    Abrir QR p/ imprimir
                  </a>
                )}
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                Digite a mesa/garçom pra gerar um QR específico (rastreia a origem).
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
