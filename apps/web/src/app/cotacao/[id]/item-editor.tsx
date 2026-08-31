'use client';

// Edição do item na própria tela da cotação: descrição, quantidade, unidade e
// a instrução que o fornecedor lê. A API (/alterar-item) já existia, mas só a
// tela de respostas usava — quem monta a cotação não tinha onde corrigir.
//
// "Gravar pro próximo pedido" guarda a descrição no PRODUTO
// (produto.descricao_compra), não no nome: o nome vem do Consumer e volta no
// próximo sync, além de carregar marca no meio ("FILE MIGNON FRIBOI") — e
// mandar marca no nome já escolhe a marca antes do fornecedor cotar.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const UNIDADES = ['un', 'kg', 'g', 'l', 'ml', 'cx', 'fardo', 'balde', 'pct', 'duzia', 'saco', 'peca'];

interface Props {
  cotacaoId: string;
  itemId: string;
  produtoNome: string;
  descricao: string | null;
  quantidade: string;
  unidade: string;
  observacao: string | null;
  /** Ex.: "fardo 30x1kg = 30 kg" — do cadastro de embalagens do produto. */
  embalagem: string | null;
  podeEditar: boolean;
}

function num(q: string): string {
  const n = Number(q);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : q;
}

export function ItemEditor(p: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [desc, setDesc] = useState(p.descricao ?? p.produtoNome);
  const [qtd, setQtd] = useState(String(Number(p.quantidade)));
  const [un, setUn] = useState(p.unidade);
  const [obs, setObs] = useState(p.observacao ?? '');
  const [gravar, setGravar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const mostrado = p.descricao ?? p.produtoNome;

  async function salvar() {
    const n = Number(qtd.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return setErro('quantidade tem que ser maior que zero');
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/cotacao/${p.cotacaoId}/alterar-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cotacaoItemId: p.itemId,
          quantidade: n,
          unidade: un,
          descricao: desc.trim() === p.produtoNome ? null : desc.trim(),
          observacao: obs.trim() || null,
          gravarNoProduto: gravar,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) return setErro(d.error ?? 'não deu pra salvar');
      setAberto(false);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <div>
        <button
          type="button"
          disabled={!p.podeEditar}
          onClick={() => setAberto(true)}
          className={`text-left font-medium text-slate-900 ${
            p.podeEditar ? 'underline decoration-dotted underline-offset-2 hover:text-sky-700' : 'cursor-default'
          }`}
          title={p.podeEditar ? 'Clique pra editar descrição, quantidade e instrução' : 'Cotação fechada'}
        >
          {mostrado}
        </button>
        {p.descricao && (
          <div className="text-[10px] text-slate-400" title="Nome no cadastro">
            cadastro: {p.produtoNome}
          </div>
        )}
        {p.observacao && <div className="text-[10px] text-amber-700">{p.observacao}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-sky-200 bg-sky-50/60 p-2">
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Descrição (o que o fornecedor vê)
        </label>
        <input
          autoFocus
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
        />
        <p className="mt-0.5 text-[10px] text-slate-400">cadastro: {p.produtoNome}</p>
      </div>

      <div className="flex items-center gap-1">
        <input
          value={qtd}
          inputMode="decimal"
          onChange={(e) => setQtd(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void salvar()}
          className="w-16 rounded border border-slate-300 px-1.5 py-1 text-right font-mono text-xs"
        />
        <select
          value={un}
          onChange={(e) => setUn(e.target.value)}
          className="rounded border border-slate-300 px-1 py-1 text-xs"
        >
          {(UNIDADES.includes(un) ? UNIDADES : [un, ...UNIDADES]).map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        {p.embalagem && <span className="text-[10px] text-slate-500">{p.embalagem}</span>}
      </div>

      <input
        value={obs}
        onChange={(e) => setObs(e.target.value)}
        placeholder="instrução pro fornecedor (ex: caixa fechada com 12)"
        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
      />

      <label className="flex items-center gap-1.5 text-[11px] text-slate-700">
        <input type="checkbox" checked={gravar} onChange={(e) => setGravar(e.target.checked)} />
        Gravar a descrição pro próximo pedido
      </label>

      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={salvando}
          className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:bg-slate-400"
        >
          {salvando ? 'salvando…' : 'salvar'}
        </button>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] text-slate-600"
        >
          cancelar
        </button>
      </div>
      {erro && <p className="text-[10px] text-rose-600">{erro}</p>}
    </div>
  );
}
