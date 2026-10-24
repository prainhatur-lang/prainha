'use client';

// Tela da cozinha: o que cada insumo/prato CONTÉM + "revisado".
// Herdado da ficha aparece cheio e travado ("via X"); manual é clicável.

import { useEffect, useMemo, useState } from 'react';
import type { CalculoCasa, PratoCalculado, RestricaoDef } from '@/lib/restricoes-alimentares';

function dobrar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function RestricoesClient(props: { filialId: string; restricoes: RestricaoDef[] }) {
  const R = props.restricoes;
  const [casa, setCasa] = useState<CalculoCasa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<'pratos' | 'insumos'>('pratos');
  const [busca, setBusca] = useState('');
  const [soFalta, setSoFalta] = useState(false);
  const [soMenu, setSoMenu] = useState(true);
  const [categoria, setCategoria] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => {
    setCasa(null);
    fetch(`/api/cardapio/restricoes-completo?filialId=${props.filialId}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setCasa(j);
      })
      .catch((e) => setErro(String(e?.message ?? e)));
  }, [props.filialId]);

  async function enviar(chave: string, corpo: Record<string, unknown>) {
    setOcupado(chave);
    try {
      const r = await fetch('/api/cardapio/restricoes-completo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId: props.filialId, ...corpo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setCasa(j);
    } catch (e) {
      alert(`Não salvou: ${e instanceof Error ? e.message : e}`);
    } finally {
      setOcupado(null);
    }
  }

  const termo = dobrar(busca.trim());
  const pratos = useMemo(() => {
    if (!casa) return [];
    return casa.pratos.filter((p) => {
      if (soMenu && !p.noMenu) return false;
      if (soFalta && p.revisado) return false;
      if (categoria && p.categoria !== categoria) return false;
      if (termo && !dobrar(p.nome + ' ' + p.insumos.join(' ')).includes(termo)) return false;
      return true;
    });
  }, [casa, soMenu, soFalta, termo, categoria]);
  // Categorias do Consumer com quantos pratos faltam revisar em cada uma.
  const categorias = useMemo(() => {
    const m = new Map<string, { total: number; falta: number }>();
    for (const p of casa?.pratos ?? []) {
      if (soMenu && !p.noMenu) continue;
      const c = m.get(p.categoria) ?? { total: 0, falta: 0 };
      c.total++;
      if (!p.revisado) c.falta++;
      m.set(p.categoria, c);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [casa, soMenu]);
  const insumos = useMemo(() => {
    if (!casa) return [];
    return casa.insumos.filter((i) => !termo || dobrar(i.nome).includes(termo));
  }, [casa, termo]);

  if (erro) return <p className="mt-6 text-sm text-red-600">Erro: {erro}</p>;
  if (!casa) return <p className="mt-6 text-sm text-slate-500">Calculando a casa…</p>;

  const noMenu = casa.pratos.filter((p) => p.noMenu);
  const revisados = noMenu.filter((p) => p.revisado).length;

  function chipsPrato(p: PratoCalculado) {
    return (
      <div className="flex flex-wrap gap-1">
        {R.map((r) => {
          const via = p.contem[r.codigo] ?? [];
          const manual = p.manual.includes(r.codigo);
          const herdado = via.some((v) => v !== 'marcado no prato');
          const tem = via.length > 0;
          const titulo = tem
            ? `${r.rotulo}: ${via.map((v) => (v === 'marcado no prato' ? 'marcado no prato' : `via ${v}`)).join(', ')}`
            : `${r.rotulo}: não contém (clique pra marcar no prato)`;
          return (
            <button
              key={r.codigo}
              title={titulo}
              disabled={ocupado !== null || (herdado && !manual)}
              onClick={() =>
                enviar(`${p.produtoId}:${r.codigo}`, {
                  acao: 'marca',
                  alvo: 'produto',
                  nome: p.nome,
                  restricao: r.codigo,
                  ligado: !manual,
                })
              }
              className={`rounded-full border px-1.5 py-0.5 text-[11px] ${
                tem
                  ? herdado && !manual
                    ? 'cursor-default border-amber-300 bg-amber-100 text-amber-900'
                    : 'border-red-300 bg-red-100 text-red-800'
                  : 'border-slate-200 bg-white text-slate-400 hover:border-slate-400 hover:text-slate-700'
              }`}
            >
              <span className={tem ? '' : 'opacity-40 grayscale'}>{r.emoji}</span>
              <span className="ml-0.5">{r.rotulo}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div
        className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
          casa.ligado ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'
        }`}
      >
        <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <input
            type="checkbox"
            checked={casa.ligado}
            disabled={ocupado !== null}
            onChange={(e) => {
              if (
                e.target.checked &&
                !confirm(
                  `Ligar a lista completa no QR desta casa?\n\nO cliente que marcar uma restrição só vai ver os ${revisados} prato(s) revisados que não contêm aquilo. Prato não revisado some pra ele.`,
                )
              )
                return;
              enviar('chave', { acao: 'chave', ligado: e.target.checked });
            }}
          />
          Lista completa de restrições no QR da mesa desta casa
        </label>
        <span className="text-xs text-slate-500">
          {casa.ligado
            ? 'Ligado: o cliente escolhe entre as restrições e vê só prato revisado.'
            : 'Desligado: o QR continua só com sem glúten / sem lactose, como hoje.'}
        </span>
        <span className="ml-auto text-xs font-medium text-slate-600">
          {revisados}/{noMenu.length} pratos do cardápio revisados
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['pratos', 'insumos'] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
              aba === a ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            {a === 'pratos' ? `Pratos (${casa.pratos.length})` : `Insumos (${casa.insumos.length})`}
          </button>
        ))}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={aba === 'pratos' ? 'Buscar prato ou insumo…' : 'Buscar insumo…'}
          className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
        />
        {aba === 'pratos' && (
          <>
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" checked={soFalta} onChange={(e) => setSoFalta(e.target.checked)} /> só falta
              revisar
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" checked={soMenu} onChange={(e) => setSoMenu(e.target.checked)} /> só o que está
              no cardápio
            </label>
          </>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {aba === 'pratos' ? pratos.length : insumos.length} linha(s)
        </span>
      </div>

      {aba === 'pratos' && categorias.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategoria('')}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              categoria === '' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            Todas
          </button>
          {categorias.map(([nome, c]) => (
            <button
              key={nome}
              onClick={() => setCategoria(categoria === nome ? '' : nome)}
              title={`${c.falta} de ${c.total} ainda a revisar`}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                categoria === nome
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : c.falta === 0
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              {nome}{' '}
              <span className="opacity-70">{c.falta === 0 ? '✔' : `${c.falta}/${c.total}`}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
        <span>
          <span className="rounded-full border border-amber-300 bg-amber-100 px-1.5">🟨</span> herdado da ficha (passe
          o mouse: via qual insumo)
        </span>
        <span>
          <span className="rounded-full border border-red-300 bg-red-100 px-1.5">🟥</span> marcado direto no prato
        </span>
        <span>clarinho = não contém (toque pra marcar)</span>
      </div>

      {aba === 'pratos' ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {pratos.map((p) => (
            <div key={p.produtoId} className="border-b border-slate-100 px-4 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className={`text-sm font-medium ${p.noMenu ? 'text-slate-900' : 'text-slate-400'}`}>
                    {p.nome}
                    {!p.noMenu && <span className="ml-2 text-[10px] text-slate-400">fora do cardápio</span>}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {p.fichaFonte === null
                      ? '⚠ sem ficha técnica — marque direto no prato'
                      : `${p.fichaFonte === 'casa' ? 'ficha desta casa' : `ficha da ${p.fichaFonte}`}: ${p.insumos.join(', ')}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {p.revisaoDiverge && (
                    <span className="text-[11px] text-amber-700" title="A lista mudou depois da revisão">
                      ⚠ mudou depois da revisão
                    </span>
                  )}
                  <button
                    disabled={ocupado !== null}
                    onClick={() =>
                      enviar(`rev:${p.produtoId}`, { acao: p.revisado ? 'desrevisar' : 'revisar', produtoId: p.produtoId })
                    }
                    title={
                      p.revisado && p.revisadoPor
                        ? `Revisado por ${p.revisadoPor}${p.revisadoEm ? ' em ' + new Date(p.revisadoEm).toLocaleString('pt-BR') : ''}`
                        : 'Conferi: a lista acima está certa'
                    }
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
                      p.revisado
                        ? 'border-emerald-400 bg-emerald-100 text-emerald-800'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {p.revisado ? '✔ Revisado' : 'a revisar'}
                  </button>
                </div>
              </div>
              <div className="mt-1.5">{chipsPrato(p)}</div>
            </div>
          ))}
          {pratos.length === 0 && <p className="px-4 py-8 text-center text-xs text-slate-400">Nenhum prato.</p>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {insumos.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-slate-400">
              Nenhum insumo nas fichas desta casa (nem nas fichas emprestadas de outra casa).
            </p>
          )}
          {insumos.map((i) => (
            <div key={i.nomeNorm} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
              <div className="text-sm text-slate-900">
                {i.nome}
                <span className="ml-2 text-[11px] text-slate-400">em {i.pratosNaCasa} prato(s)</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {R.map((r) => {
                  const tem = i.marcas.includes(r.codigo);
                  return (
                    <button
                      key={r.codigo}
                      title={r.rotulo}
                      disabled={ocupado !== null}
                      onClick={() =>
                        enviar(`ins:${i.nomeNorm}:${r.codigo}`, {
                          acao: 'marca',
                          alvo: 'insumo',
                          nome: i.nome,
                          restricao: r.codigo,
                          ligado: !tem,
                        })
                      }
                      className={`rounded-full border px-1.5 py-0.5 text-[11px] ${
                        tem
                          ? 'border-amber-300 bg-amber-100 text-amber-900'
                          : 'border-slate-200 bg-white text-slate-400 hover:border-slate-400 hover:text-slate-700'
                      }`}
                    >
                      <span className={tem ? '' : 'opacity-40 grayscale'}>{r.emoji}</span>
                      <span className="ml-0.5">{r.rotulo}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
