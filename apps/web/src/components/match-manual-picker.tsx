'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

export interface CandidatoMatch {
  id: string;
  data: string; // string pra exibir (DD/MM/YYYY ou YYYY-MM-DD)
  valor: number;
  descricao: string;
}

interface Props {
  excecaoId: string;
  valorPrincipal: number;
  candidatos: CandidatoMatch[];
  titulo?: string;
  subtitulo?: string;
  /** Texto do botão que abre o modal */
  botaoLabel?: string;
}

function formatData(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10).split('-').reverse().join('/');
  }
  return s;
}

export function MatchManualPicker({
  excecaoId,
  valorPrincipal,
  candidatos,
  titulo = 'Match manual',
  subtitulo = 'Selecione os pares que correspondem a essa exceção.',
  botaoLabel = 'Conciliar manual',
}: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [obs, setObs] = useState('');
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Ordena candidatos por proximidade de valor (mais perto primeiro) +
  // proximidade de data como tiebreaker. Ajuda a escanear pares plausíveis
  // sem ter que ler 200 linhas — o que mais faz sentido sobe pro topo.
  const candidatosOrdenados = useMemo(() => {
    const alvoValor = Math.abs(valorPrincipal);
    return [...candidatos].sort((a, b) => {
      const dValA = Math.abs(Math.abs(a.valor) - alvoValor);
      const dValB = Math.abs(Math.abs(b.valor) - alvoValor);
      if (dValA !== dValB) return dValA - dValB;
      return a.data.localeCompare(b.data);
    });
  }, [candidatos, valorPrincipal]);

  // Filtro de candidatos por NSU/autorização/valor/descrição/data.
  // Suporta:
  //  - "414,70" ou "414.70" → casa por valor (com tolerância de 1 centavo)
  //  - "20/04" ou "20/04/2026" → casa por data (DD/MM ou DD/MM/YYYY)
  //  - qualquer texto → busca substring na descrição
  const candidatosFiltrados = useMemo(() => {
    const b = busca.trim();
    if (!b) return candidatosOrdenados;
    const bLower = b.toLowerCase();

    // Tenta interpretar como número
    const numMatch = b.match(/^[\d.,]+$/);
    let valorBuscado: number | null = null;
    if (numMatch) {
      const n = Number(b.replace(/\./g, '').replace(',', '.'));
      if (Number.isFinite(n)) valorBuscado = Math.abs(n);
    }

    // Tenta interpretar como data DD/MM ou DD/MM/YYYY
    const dataMatch = b.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    let dataBuscadaParcial: string | null = null;
    if (dataMatch) {
      const [, dd, mm, yyyy] = dataMatch;
      const ddPad = dd!.padStart(2, '0');
      const mmPad = mm!.padStart(2, '0');
      dataBuscadaParcial = yyyy ? `${ddPad}/${mmPad}/${yyyy.padStart(4, '20'.slice(0, 4 - yyyy.length) + yyyy)}` : `${ddPad}/${mmPad}/`;
    }

    return candidatosOrdenados.filter((c) => {
      if (valorBuscado !== null) {
        if (Math.abs(Math.abs(c.valor) - valorBuscado) <= 0.01) return true;
      }
      if (dataBuscadaParcial !== null) {
        const dataIso = c.data.slice(0, 10);
        const dataBr = /^\d{4}-\d{2}-\d{2}/.test(dataIso)
          ? dataIso.split('-').reverse().join('/')
          : dataIso;
        if (dataBr.startsWith(dataBuscadaParcial)) return true;
      }
      // Match em descrição (case-insensitive, substring)
      if (c.descricao.toLowerCase().includes(bLower)) return true;
      return false;
    });
  }, [busca, candidatosOrdenados]);

  const soma = useMemo(
    () =>
      [...sel].reduce((s, id) => {
        const c = candidatos.find((x) => x.id === id);
        return s + Math.abs(c?.valor ?? 0);
      }, 0),
    [sel, candidatos],
  );
  const diff = +(soma - Math.abs(valorPrincipal)).toFixed(2);
  // Indicador visual: bate = diff <= R$ 0,10 (verde no card)
  // Mas o botao NAO fica disabled por isso — match manual e responsabilidade
  // do user (ex: garcom errou forma e Cielo cobrou taxa, gerando diff legitimo).
  const bate = Math.abs(diff) <= 0.10;
  const pctDiff = Math.abs(valorPrincipal) > 0
    ? Math.abs(diff / valorPrincipal) * 100
    : 0;

  function toggle(id: string) {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSel(n);
  }

  async function aplicar() {
    if (sel.size === 0) return;
    // Diff > R$ 0,10 — pede confirmacao explicita e seta flag pro backend
    // aceitar fora da tolerancia. Sem flag o backend rejeita com 422.
    let forcarAceiteForaTolerancia = false;
    if (Math.abs(diff) > 0.10) {
      const ok = confirm(
        `Diferenca de ${diff >= 0 ? '+' : ''}${diff.toFixed(2).replace('.', ',')} (${pctDiff.toFixed(2)}%) — fora da tolerancia (R$ 0,10).\n\n` +
          `Pode ser: taxa Cielo, garcom errou forma, ou outra coisa.\n` +
          `Recomendado preencher uma observacao explicando.\n\n` +
          `Conciliar mesmo assim?`,
      );
      if (!ok) return;
      forcarAceiteForaTolerancia = true;
    }
    setErro(null);
    try {
      const r = await fetch('/api/excecoes/match-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          excecaoId,
          pariaIds: [...sel],
          observacao: obs || undefined,
          ...(forcarAceiteForaTolerancia ? { forcarAceiteForaTolerancia: true } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.mensagem || j.error || `HTTP ${r.status}`);
      setAberto(false);
      start(() => router.refresh());
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
      >
        {botaoLabel}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {titulo} — R$ {Math.abs(valorPrincipal).toFixed(2).replace('.', ',')}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">{subtitulo}</p>
          </div>
          <button
            onClick={() => setAberto(false)}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="mt-4">
          <input
            type="text"
            placeholder="Buscar por NSU, autorização, valor (414,70), data (20/04)..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
          />
          {busca && (
            <p className="mt-1 text-[10px] text-slate-500">
              Mostrando {candidatosFiltrados.length} de {candidatos.length} candidatos
            </p>
          )}
        </div>

        <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-200">
          {candidatos.length === 0 ? (
            <p className="p-3 text-xs text-slate-500">Nenhum candidato disponível.</p>
          ) : candidatosFiltrados.length === 0 ? (
            <p className="p-3 text-xs text-slate-500">
              Nenhum candidato bate com a busca. Limpe o filtro ou ajuste o termo.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left font-medium text-slate-600">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2 text-right">Diff</th>
                  <th className="px-3 py-2">Descrição</th>
                </tr>
              </thead>
              <tbody>
                {candidatosFiltrados.map((c) => {
                  const marcado = sel.has(c.id);
                  // Diff individual deste candidato vs valor alvo (independente
                  // de outros que estejam marcados). Ajuda a identificar pares
                  // plausiveis de relance.
                  const diffCand = +(Math.abs(c.valor) - Math.abs(valorPrincipal)).toFixed(2);
                  const pctCand = Math.abs(valorPrincipal) > 0
                    ? Math.abs(diffCand / valorPrincipal) * 100
                    : 0;
                  const corDiff =
                    Math.abs(diffCand) <= 0.10
                      ? 'text-emerald-700'
                      : pctCand < 1
                        ? 'text-amber-700'
                        : 'text-rose-700';
                  return (
                    <tr
                      key={c.id}
                      onClick={() => toggle(c.id)}
                      className={`cursor-pointer border-t border-slate-100 ${
                        marcado ? 'bg-emerald-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => toggle(c.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700">
                        {formatData(c.data)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium text-slate-900">
                        {brl(c.valor)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${corDiff}`}>
                        {diffCand >= 0 ? '+' : ''}
                        {brl(diffCand)}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        <span className="block max-w-xs truncate" title={c.descricao}>
                          {c.descricao}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-600">Selecionado:</span>
            <span className="font-mono font-semibold text-slate-900">
              {brl(soma)} ({sel.size} item{sel.size !== 1 ? 's' : ''})
            </span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-slate-600">Esperado:</span>
            <span className="font-mono text-slate-900">{brl(Math.abs(valorPrincipal))}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
            <span className="text-slate-600">Diferença:</span>
            <span
              className={`font-mono font-semibold ${
                bate ? 'text-emerald-700' : pctDiff < 1 ? 'text-amber-700' : 'text-rose-700'
              }`}
            >
              {diff >= 0 ? '+' : ''}
              {brl(diff)}
              {pctDiff > 0 && (
                <span className="ml-1 text-[10px]">({pctDiff.toFixed(2)}%)</span>
              )}
            </span>
          </div>
          {!bate && Math.abs(pctDiff - 0.49) < 0.05 && (
            <p className="mt-1.5 rounded bg-amber-100 p-1.5 text-[10px] text-amber-900">
              ℹ Diff bate exato com taxa Cielo Pix (0,49%) — provavelmente
              garçom marcou forma errada (passou pela maquininha como
              &quot;Pix Manual&quot;).
            </p>
          )}
        </div>

        <input
          type="text"
          placeholder="Observação (opcional)"
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          className="mt-3 w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
        />

        <div className="mt-3 flex justify-end gap-2">
          {erro && <span className="mr-auto text-xs text-rose-600">{erro}</span>}
          <button
            onClick={() => setAberto(false)}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={aplicar}
            disabled={sel.size === 0 || pending}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? 'Aplicando...' : 'Conciliar'}
          </button>
        </div>
      </div>
    </div>
  );
}
