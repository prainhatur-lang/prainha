'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  filialId: string;
  tipo: string;
  qtdTotal: number;
  qtdBaixa: number; // severidade BAIXA = ALTA confiabilidade (forma divergente / autoAceita)
  qtdMedia: number; // severidade MEDIA = diff fora de tolerancia pequena
}

type Filtro = 'BAIXA' | 'MEDIA' | null;

const LABELS: Record<NonNullable<Filtro> | 'TODAS', string> = {
  BAIXA: 'alta confiabilidade',
  MEDIA: 'média confiabilidade',
  TODAS: 'todas (qualquer confiabilidade)',
};

const DESCRICOES: Record<NonNullable<Filtro> | 'TODAS', string> = {
  BAIXA:
    'Diferença de valor zero — só forma de pagamento diverge (ex: garçom apertou Crédito mas era Débito). Match certo.',
  MEDIA:
    'Diferença de valor pequena dentro de tolerância maior. Tipicamente gorjeta, desconto, couvert.',
  TODAS:
    'Aceita TODAS independente da confiabilidade. Use só se já revisou cada uma.',
};

export function AceitarTodosBtn({ filialId, tipo, qtdTotal, qtdBaixa, qtdMedia }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function fechaOnClickFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    function fechaOnEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false);
    }
    document.addEventListener('mousedown', fechaOnClickFora);
    document.addEventListener('keydown', fechaOnEsc);
    return () => {
      document.removeEventListener('mousedown', fechaOnClickFora);
      document.removeEventListener('keydown', fechaOnEsc);
    };
  }, [aberto]);

  async function aceitar(filtro: Filtro) {
    const chave = filtro ?? 'TODAS';
    const qtd = filtro === 'BAIXA' ? qtdBaixa : filtro === 'MEDIA' ? qtdMedia : qtdTotal;
    if (qtd === 0) {
      setMsg('Nenhuma exceção neste filtro.');
      return;
    }
    if (
      !confirm(
        `Aceitar ${qtd} divergência(s) de ${LABELS[chave]}?\n\n` +
          `${DESCRICOES[chave]}\n\n` +
          `Pra cada uma, sistema:\n` +
          `• Marca como aceita\n` +
          `• Aplica forma/bandeira da Cielo como efetiva\n` +
          `• Cria match firme manual (não volta a ser exceção)\n\n` +
          `Não pode ser desfeito facilmente. Continuar?`,
      )
    ) {
      return;
    }
    setLoading(true);
    setMsg(null);
    setAberto(false);
    try {
      const r = await fetch('/api/excecoes/aceitar-todos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId,
          tipo,
          processo: 'OPERADORA',
          ...(filtro ? { severidade: filtro } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(`Erro: ${d.error ?? r.status}`);
        return;
      }
      setMsg(`✓ ${d.aceitas} aceitas (${d.comFormaEfetiva} com correção de forma)`);
      start(() => router.refresh());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={ref} className="relative flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        disabled={loading || pending}
        className="shrink-0 rounded-md border border-emerald-700 bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {loading ? 'Aceitando...' : `✓ Aceitar todos (${qtdTotal}) ▾`}
      </button>

      {aberto && !loading && (
        <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2 text-[10px] uppercase tracking-wide text-slate-500">
            Filtrar por confiabilidade
          </div>

          <button
            type="button"
            onClick={() => aceitar('BAIXA')}
            disabled={qtdBaixa === 0}
            className="block w-full px-3 py-2 text-left hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-700">
                ✓ Alta confiabilidade
              </span>
              <span className="text-[11px] font-medium text-slate-600">{qtdBaixa}</span>
            </div>
            <p className="mt-0.5 text-[10px] leading-tight text-slate-500">
              {DESCRICOES.BAIXA}
            </p>
          </button>

          <button
            type="button"
            onClick={() => aceitar('MEDIA')}
            disabled={qtdMedia === 0}
            className="block w-full border-t border-slate-100 px-3 py-2 text-left hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-700">
                ✓ Média confiabilidade
              </span>
              <span className="text-[11px] font-medium text-slate-600">{qtdMedia}</span>
            </div>
            <p className="mt-0.5 text-[10px] leading-tight text-slate-500">
              {DESCRICOES.MEDIA}
            </p>
          </button>

          <button
            type="button"
            onClick={() => aceitar(null)}
            disabled={qtdTotal === 0}
            className="block w-full border-t border-slate-100 px-3 py-2 text-left hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-700">
                ✓ Todas (qualquer)
              </span>
              <span className="text-[11px] font-medium text-slate-600">{qtdTotal}</span>
            </div>
            <p className="mt-0.5 text-[10px] leading-tight text-slate-500">
              {DESCRICOES.TODAS}
            </p>
          </button>
        </div>
      )}

      {msg && <span className="text-[10px] text-slate-600">{msg}</span>}
    </div>
  );
}
