'use client';

// Clicar tem que ser rápido: o dono vai passar por 1.376 produtos. Então tudo
// é local (nenhuma chamada por clique) e só o SALVAR manda a diferença — assim
// dá pra ligar uma categoria inteira e ajustar as exceções sem esperar rede.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { normalizaBusca } from '@/lib/texto';

export interface ProdutoLinha {
  id: string;
  nome: string;
  preco: number | null;
  categoria: string;
  ativo: boolean;
  /** Vende numa filial irmã — o atalho de decisão. */
  naIrma: boolean;
  /** Teve venda aqui nos últimos 90 dias. */
  jaVendeu: boolean;
}

interface Props {
  filialId: string;
  filialNome: string;
  linhas: ProdutoLinha[];
}

const brl = (v: number | null) =>
  v == null ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function AtivarClient({ filialId, filialNome, linhas }: Props) {
  const router = useRouter();
  const [ativos, setAtivos] = useState<Set<string>>(
    () => new Set(linhas.filter((l) => l.ativo).map((l) => l.id)),
  );
  const [busca, setBusca] = useState('');
  const [soDiferentes, setSoDiferentes] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const originais = useMemo(
    () => new Set(linhas.filter((l) => l.ativo).map((l) => l.id)),
    [linhas],
  );

  const filtradas = useMemo(() => {
    const q = normalizaBusca(busca.trim());
    return linhas.filter((l) => {
      if (soDiferentes && ativos.has(l.id) === originais.has(l.id)) return false;
      if (!q) return true;
      return normalizaBusca(l.nome).includes(q) || normalizaBusca(l.categoria).includes(q);
    });
  }, [linhas, busca, soDiferentes, ativos, originais]);

  const grupos = useMemo(() => {
    const m = new Map<string, ProdutoLinha[]>();
    for (const l of filtradas) {
      if (!m.has(l.categoria)) m.set(l.categoria, []);
      m.get(l.categoria)!.push(l);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [filtradas]);

  const mudancas = useMemo(() => {
    let ligar = 0;
    let desligar = 0;
    for (const l of linhas) {
      const agora = ativos.has(l.id);
      if (agora && !l.ativo) ligar++;
      if (!agora && l.ativo) desligar++;
    }
    return { ligar, desligar };
  }, [linhas, ativos]);

  function alternar(id: string) {
    setAtivos((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function marcarGrupo(itens: ProdutoLinha[], ligar: boolean) {
    setAtivos((prev) => {
      const n = new Set(prev);
      for (const i of itens) {
        if (ligar) n.add(i.id);
        else n.delete(i.id);
      }
      return n;
    });
  }

  /** Atalho do dono: "o que sai lá sai aqui". */
  function ligarOsDaIrma() {
    setAtivos((prev) => {
      const n = new Set(prev);
      for (const l of filtradas) if (l.naIrma) n.add(l.id);
      return n;
    });
  }

  async function salvar() {
    // Desativar tira o produto do PDV da loja: confirma dizendo QUAL loja.
    // (02/09/2026: curadoria feita na loja errada por falta desse aviso.)
    if (mudancas.desligar > 0) {
      const ok = window.confirm(
        `Desativar ${mudancas.desligar} produto(s) em ${filialNome}?\n\n` +
          `Eles saem do PDV do garçom DESTA loja. As outras lojas não mudam.` +
          (mudancas.ligar > 0 ? `\n\nTambém serão ativados ${mudancas.ligar} produto(s).` : ''),
      );
      if (!ok) return;
    }
    setSalvando(true);
    setErro(null);
    setMsg(null);
    try {
      const r = await fetch('/api/cadastros/produtos/ativar-lote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          // Escopo = tudo que esta tela carregou, não só o que está filtrado:
          // senão uma busca ativa faria o resto do cardápio ser desligado.
          escopo: linhas.map((l) => l.id),
          ativos: Array.from(ativos),
        }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        error?: string; nada?: boolean; ativados?: number; inativados?: number;
      };
      if (!r.ok) {
        setErro(d.error ?? 'não deu pra salvar');
        return;
      }
      setMsg(
        d.nada
          ? 'Nada mudou.'
          : `${d.ativados ?? 0} ligado(s) e ${d.inativados ?? 0} desligado(s). A loja aplica no PDV em ~1 min.`,
      );
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const temMudanca = mudancas.ligar > 0 || mudancas.desligar > 0;

  return (
    <div className="space-y-3">
      <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar produto ou categoria..."
          className="min-w-48 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={ligarOsDaIrma}
          className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100"
          title="Liga tudo que já é vendido nas outras lojas (dentro do filtro atual)"
        >
          Ligar o que as outras lojas vendem
        </button>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={soDiferentes}
            onChange={(e) => setSoDiferentes(e.target.checked)}
          />
          só o que mudei
        </label>
        <span className="text-xs text-slate-500">
          {ativos.size} ligado(s) de {linhas.length}
        </span>
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={salvando || !temMudanca}
          className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:bg-slate-300"
        >
          {salvando
            ? 'Salvando…'
            : temMudanca
              ? `Salvar em ${filialNome} (+${mudancas.ligar} / −${mudancas.desligar})`
              : 'Sem mudanças'}
        </button>
      </div>

      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{msg}</p>}
      {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{erro}</p>}

      {grupos.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Nada com esse filtro.
        </p>
      )}

      {grupos.map(([categoria, itens]) => {
        const ligadosNoGrupo = itens.filter((i) => ativos.has(i.id)).length;
        return (
          <section key={categoria} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-700">
                {categoria}{' '}
                <span className="font-normal text-slate-400">
                  ({ligadosNoGrupo}/{itens.length})
                </span>
              </h2>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => marcarGrupo(itens, true)}
                  className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800"
                >
                  ligar todos
                </button>
                <button
                  type="button"
                  onClick={() => marcarGrupo(itens, false)}
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600"
                >
                  desligar todos
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
              {itens.map((l) => {
                const on = ativos.has(l.id);
                const mudou = on !== l.ativo;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => alternar(l.id)}
                    className={`flex items-start gap-2 p-2.5 text-left transition-colors ${
                      on ? 'bg-emerald-50 hover:bg-emerald-100' : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] font-bold ${
                        on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-xs ${on ? 'font-medium text-slate-900' : 'text-slate-500'}`}>
                        {l.nome}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
                        {l.preco != null && l.preco > 0 && (
                          <span className="text-slate-400">{brl(l.preco)}</span>
                        )}
                        {l.jaVendeu && (
                          <span className="rounded bg-sky-100 px-1 py-px font-medium text-sky-800">
                            já vendeu aqui
                          </span>
                        )}
                        {l.naIrma && !l.jaVendeu && (
                          <span className="rounded bg-slate-100 px-1 py-px text-slate-500">
                            outra loja vende
                          </span>
                        )}
                        {mudou && (
                          <span className="rounded bg-amber-100 px-1 py-px font-medium text-amber-800">
                            {on ? 'vai ligar' : 'vai desligar'}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
