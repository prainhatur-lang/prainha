'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Colaborador {
  id: string;
  nome: string;
  tipo: string;
  ativo: boolean;
  tokenAcesso: string | null;
  ultimaAtividadeEm: string | null;
}

export function ColaboradorRow({ colaborador }: { colaborador: Colaborador }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(colaborador.tokenAcesso);
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [copiou, setCopiou] = useState(false);
  const [_pending, start] = useTransition();

  const url = token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/cozinheiro/${token}`
    : '';

  async function gerarLink() {
    setCarregando(true);
    try {
      const r = await fetch(`/api/colaborador/${colaborador.id}/gerar-link`, {
        method: 'POST',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(`Erro: ${d.error ?? r.status}`);
        return;
      }
      setToken(d.token);
      setAberto(true);
      start(() => router.refresh());
    } finally {
      setCarregando(false);
    }
  }

  function copiar() {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiou(true);
    setTimeout(() => setCopiou(false), 2000);
  }

  function whatsapp() {
    if (!url) return;
    const msg = `Oi ${colaborador.nome}! Esse é o seu painel pessoal de produção. Salve esse link no seu celular pra ver suas ordens de serviço:\n\n${url}\n\nNo Chrome do celular: tocar no menu (⋮) → "Adicionar à tela inicial".`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }

  async function desativar() {
    if (!confirm(`Desativar "${colaborador.nome}"? Não aparecerá mais no autocomplete.`)) return;
    const r = await fetch(`/api/colaborador/${colaborador.id}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return;
    }
    start(() => router.refresh());
  }

  return (
    <div
      className={`rounded-xl border p-4 ${
        colaborador.ativo ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-70'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-slate-900">
              👨‍🍳 {colaborador.nome}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
              {colaborador.tipo}
            </span>
            {!colaborador.ativo && (
              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                Inativo
              </span>
            )}
          </div>
          {colaborador.ultimaAtividadeEm && (
            <p className="mt-1 text-[11px] text-slate-500">
              Última OP em{' '}
              {new Date(colaborador.ultimaAtividadeEm).toLocaleDateString('pt-BR')}
            </p>
          )}
          {token && (
            <button
              type="button"
              onClick={() => setAberto(!aberto)}
              className="mt-2 text-[11px] text-sky-700 hover:underline"
            >
              {aberto ? '▲ esconder link' : '▼ ver link do painel'}
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {!token ? (
            <button
              type="button"
              onClick={gerarLink}
              disabled={carregando || !colaborador.ativo}
              className="rounded-lg border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {carregando ? 'Gerando...' : '📱 Gerar link do painel'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={copiar}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  copiou
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {copiou ? '✓ Copiado!' : '📋 Copiar link'}
              </button>
              <button
                type="button"
                onClick={whatsapp}
                className="rounded-lg border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
              >
                💬 WhatsApp
              </button>
            </>
          )}
          {colaborador.ativo && (
            <button
              type="button"
              onClick={desativar}
              className="rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-[11px] text-rose-700 hover:bg-rose-50"
              title="Desativar (preserva histórico)"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {aberto && token && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <div className="rounded-lg bg-slate-50 p-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Link permanente
            </p>
            <p className="mt-0.5 break-all font-mono text-[10px] text-slate-700">
              {url}
            </p>
          </div>
          <p className="text-[10px] text-slate-500">
            🔒 Quem tem esse link vê todas as OPs atribuídas a {colaborador.nome}.
            Compartilhe direto com ele (WhatsApp), e oriente a salvar &ldquo;na tela
            inicial&rdquo; do celular pra acessar como app.
          </p>
        </div>
      )}
    </div>
  );
}
