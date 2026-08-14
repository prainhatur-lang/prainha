'use client';

// Lista do cardápio com selos 🌾 sem glúten / 🥛 sem lactose. Busca no topo
// (garçom digita "moqueca" e vê na hora), filtros rápidos, toque no selo pra
// ligar/desligar (salva sozinho).

import { useMemo, useState } from 'react';

interface ItemCardapio {
  id: string;
  nome: string;
  descricao: string;
  /** Pausado no PDV — não aparece no cardápio público, mas o selo fica pronto. */
  pausado: boolean;
  semGluten: boolean;
  semLactose: boolean;
  obs: string;
}

function dobrar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function CardapioClient(props: { itens: ItemCardapio[] }) {
  const [itens, setItens] = useState(props.itens);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'semGluten' | 'semLactose'>('todos');
  const [salvando, setSalvando] = useState<string | null>(null);

  const visiveis = useMemo(() => {
    const termo = dobrar(busca.trim());
    return itens.filter((i) => {
      if (filtro === 'semGluten' && !i.semGluten) return false;
      if (filtro === 'semLactose' && !i.semLactose) return false;
      if (termo && !dobrar(i.nome + ' ' + i.descricao).includes(termo)) return false;
      return true;
    });
  }, [itens, busca, filtro]);

  async function alternar(item: ItemCardapio, campo: 'semGluten' | 'semLactose') {
    const novo = { ...item, [campo]: !item[campo] };
    setSalvando(item.id);
    try {
      const r = await fetch('/api/cardapio/restricoes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          produtoId: item.id,
          semGluten: novo.semGluten,
          semLactose: novo.semLactose,
          obs: novo.obs || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setItens((prev) => prev.map((x) => (x.id === item.id ? novo : x)));
    } catch (e) {
      alert(`Não salvou: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSalvando(null);
    }
  }

  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar prato… (ex: moqueca)"
          className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
        />
        {(
          [
            ['todos', 'Todos'],
            ['semGluten', '🌾 Sem glúten'],
            ['semLactose', '🥛 Sem lactose'],
          ] as const
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            onClick={() => setFiltro(valor)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
              filtro === valor
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {rotulo}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-400">{visiveis.length} prato(s)</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {visiveis.map((i) => (
          <div
            key={i.id}
            className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-2.5"
          >
            <div className="min-w-0">
              <div className={`text-sm font-medium ${i.pausado ? 'text-slate-400' : 'text-slate-900'}`}>
                {i.nome}
                {i.pausado && (
                  <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                    pausado no PDV
                  </span>
                )}
              </div>
              {i.descricao && (
                <div className="truncate text-[11px] text-slate-500">{i.descricao}</div>
              )}
              {i.obs && <div className="text-[11px] text-amber-700">⚠ {i.obs}</div>}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                disabled={salvando === i.id}
                onClick={() => alternar(i, 'semGluten')}
                className={`rounded-full border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                  i.semGluten
                    ? 'border-emerald-400 bg-emerald-100 text-emerald-800'
                    : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}
                title="Sem glúten (confirmado pela cozinha)"
              >
                🌾 s/ glúten
              </button>
              <button
                disabled={salvando === i.id}
                onClick={() => alternar(i, 'semLactose')}
                className={`rounded-full border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                  i.semLactose
                    ? 'border-sky-400 bg-sky-100 text-sky-800'
                    : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}
                title="Sem lactose (confirmado pela cozinha)"
              >
                🥛 s/ lactose
              </button>
            </div>
          </div>
        ))}
        {visiveis.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-slate-400">Nenhum prato encontrado.</p>
        )}
      </div>
    </div>
  );
}
