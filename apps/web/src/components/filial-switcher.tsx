'use client';

// Seletor de filial no topo do menu. A escolha grava cookie no servidor e vale
// pra todas as telas até trocar de novo — ninguém precisa clicar filial em
// cada página.
//
// Detalhe que importa: se a URL atual tem ?filialId=, ela tem precedência sobre
// o cookie (link compartilhado). Então ao trocar, limpamos o parâmetro da URL,
// senão a tela continuaria na filial antiga e pareceria que não funcionou.

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

interface FilialOpt {
  id: string;
  nome: string;
  organizacao: string | null;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

export function FilialSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  // Lemos a query do window em vez de useSearchParams(): o seletor vive no
  // menu, que renderiza em toda página — useSearchParams() obrigaria cada uma
  // delas a ter <Suspense> no build.
  const [queryString, setQueryString] = useState('');

  const [filiais, setFiliais] = useState<FilialOpt[]>([]);
  const [ativaId, setAtivaId] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [trocando, setTrocando] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/filial-ativa', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { filiais?: FilialOpt[]; ativaId?: string | null } | null) => {
        if (cancelled || !data) return;
        setFiliais(Array.isArray(data.filiais) ? data.filiais : []);
        setAtivaId(data.ativaId ?? null);
      })
      .catch(() => {
        // silencioso: sem o seletor o app segue usando a filial padrão
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setQueryString(window.location.search);
  }, [pathname]);

  // A filial da URL manda na página renderizada — reflete isso no seletor.
  const filialDaUrl = new URLSearchParams(queryString).get('filialId');
  const selecionadaId = filialDaUrl && filiais.some((f) => f.id === filialDaUrl) ? filialDaUrl : ativaId;
  const selecionada = filiais.find((f) => f.id === selecionadaId) ?? null;

  const trocar = useCallback(
    async (filialId: string) => {
      if (filialId === selecionadaId) {
        setAberto(false);
        return;
      }
      setTrocando(filialId);
      try {
        const r = await fetch('/api/filial-ativa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filialId }),
        });
        if (!r.ok) return;
        setAtivaId(filialId);
        setAberto(false);

        // Tira o ?filialId= da URL pra não sobrepor a escolha nova.
        const qs = new URLSearchParams(window.location.search);
        if (qs.has('filialId')) {
          qs.delete('filialId');
          const query = qs.toString();
          setQueryString(query ? `?${query}` : '');
          router.replace(query ? `${pathname}?${query}` : pathname);
        }
        router.refresh();
      } finally {
        setTrocando(null);
      }
    },
    [selecionadaId, pathname, router],
  );

  // Sem filial nenhuma não há o que mostrar; com uma só, vira etiqueta fixa.
  if (filiais.length === 0) return null;
  const podeTrocar = filiais.length > 1;

  return (
    <div className="relative border-b border-slate-200 px-3 py-2">
      <button
        type="button"
        aria-expanded={aberto}
        aria-haspopup="listbox"
        disabled={!podeTrocar}
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition-colors enabled:hover:bg-slate-50 disabled:cursor-default"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Filial
          </span>
          <span className="block truncate text-sm font-semibold text-slate-900">
            {selecionada?.nome ?? 'Escolher filial'}
          </span>
        </span>
        {podeTrocar && <ChevronIcon open={aberto} />}
      </button>

      {aberto && (
        <>
          <button
            type="button"
            aria-label="Fechar seleção de filial"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setAberto(false)}
          />
          <ul
            role="listbox"
            className="absolute left-3 right-3 z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          >
            {filiais.map((f) => {
              const ativa = f.id === selecionadaId;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={ativa}
                    disabled={trocando != null}
                    onClick={() => void trocar(f.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors disabled:opacity-60 ${
                      ativa ? 'bg-slate-50 font-semibold text-slate-950' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className={ativa ? 'text-emerald-600' : 'invisible'}>
                      <CheckIcon />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{f.nome}</span>
                    {trocando === f.id && <span className="text-[11px] text-slate-400">trocando…</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
