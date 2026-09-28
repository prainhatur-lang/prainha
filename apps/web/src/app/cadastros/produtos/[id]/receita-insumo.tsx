'use client';

// Receita de um insumo feito de insumos (molho pesto = manjericão + azeite +
// castanha...). Mostra, com o estoque de agora, quanto dá pra produzir e
// quem limita; "Produzir" cria a OP do template e já conclui (baixa os
// ingredientes, entra o molho, calcula o custo). A receita é o template de
// produção que tem este produto como saída — a mesma de /cadastros/templates-producao.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { normalizaBusca } from '@/lib/texto';
import { BotaoConfirmarConversao } from '@/components/conversao-embalagem';

export interface ItemReceita {
  produtoId: string;
  nome: string;
  unidade: string;
  quantidade: number;
  estoque: number;
  custo: number;
}

interface Opcao {
  id: string;
  nome: string;
  unidade: string;
}

const fmt = (n: number, d = 2) => n.toLocaleString('pt-BR', { maximumFractionDigits: d });
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (s: string) => {
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

export function ReceitaInsumo({
  produtoId,
  produtoNome,
  unidade,
  controla,
  estoqueAtual,
  templateId,
  rendimento,
  itens,
  sugestaoFicha,
  opcoes,
}: {
  produtoId: string;
  produtoNome: string;
  unidade: string;
  controla: boolean;
  estoqueAtual: number;
  templateId: string | null;
  rendimento: number | null;
  itens: ItemReceita[];
  /** Ficha técnica antiga (não baixa nada num insumo) — vira ponto de partida. */
  sugestaoFicha: ItemReceita[];
  opcoes: Opcao[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editando, setEditando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [produzindo, setProduzindo] = useState(false);
  const [qtdProduzir, setQtdProduzir] = useState(rendimento ? String(rendimento) : '');
  const [ok, setOk] = useState<string | null>(null);

  const temReceita = templateId != null && rendimento != null && rendimento > 0 && itens.length > 0;

  // Quanto dá pra fazer com o estoque de agora: o ingrediente que acaba primeiro manda.
  const capacidade = useMemo(() => {
    if (!temReceita) return null;
    let receitas = Infinity;
    let limitante: ItemReceita | null = null;
    for (const i of itens) {
      if (i.quantidade <= 0) continue;
      const r = Math.max(0, i.estoque) / i.quantidade;
      if (r < receitas) {
        receitas = r;
        limitante = i;
      }
    }
    if (!Number.isFinite(receitas)) return null;
    return { receitas, quantidade: receitas * rendimento!, limitante };
  }, [temReceita, itens, rendimento]);

  const custoReceita = itens.reduce((s, i) => s + i.quantidade * i.custo, 0);
  const custoUnit = temReceita ? custoReceita / rendimento! : 0;
  const semCusto = itens.filter((i) => i.custo <= 0);

  const q = num(qtdProduzir);
  const fator = temReceita && q > 0 ? q / rendimento! : 0;
  const faltando = itens.filter((i) => i.quantidade * fator > Math.max(0, i.estoque) + 1e-9);

  async function produzir() {
    if (!templateId || fator <= 0) return;
    setErro(null);
    setOk(null);
    setProduzindo(true);
    try {
      const r1 = await fetch(`/api/template-op/${templateId}/criar-op`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fatorEscala: Number(fator.toFixed(6)), descricao: `${produtoNome} — ${fmt(q)} ${unidade}` }),
      });
      const d1 = await r1.json().catch(() => ({}));
      if (!r1.ok || !d1.opId) throw new Error(d1.error ?? `HTTP ${r1.status}`);
      const r2 = await fetch(`/api/ordem-producao/${d1.opId}/concluir`, { method: 'POST' });
      const d2 = await r2.json().catch(() => ({}));
      if (!r2.ok) {
        setErro(`A ordem foi criada mas não fechou: ${d2.error ?? `HTTP ${r2.status}`}. Abra a ordem pra conferir.`);
        router.push(`/movimento/producao/${d1.opId}`);
        return;
      }
      setOk(`Produzido: ${fmt(q)} ${unidade} de ${produtoNome}. Ingredientes baixados do estoque.`);
      start(() => router.refresh());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setProduzindo(false);
    }
  }

  if (editando) {
    return (
      <EditorReceita
        produtoId={produtoId}
        unidade={unidade}
        rendimentoInicial={rendimento}
        itensIniciais={temReceita ? itens : sugestaoFicha}
        temFichaAntiga={sugestaoFicha.length > 0}
        opcoes={opcoes}
        onCancelar={() => setEditando(false)}
        onSalvo={() => {
          setEditando(false);
          start(() => router.refresh());
        }}
      />
    );
  }

  if (!temReceita) {
    return (
      <div className="mb-6 rounded-xl border border-dashed border-slate-300 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Receita deste insumo</h3>
        <p className="mt-1 text-xs text-slate-600">
          Se {produtoNome} é feito aqui (molho, massa, caldo…), cadastre do que ele é feito e quanto rende.
          Aí esta tela mostra quanto dá pra produzir com o estoque de hoje, e o botão Produzir baixa os
          ingredientes e dá entrada no {produtoNome}.
        </p>
        {sugestaoFicha.length > 0 && (
          <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
            Tem uma ficha técnica antiga neste insumo ({sugestaoFicha.length} itens). Ficha técnica de insumo
            não baixa nada — ela vai servir de ponto de partida pra receita.
          </p>
        )}
        {!controla && (
          <p className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-800">
            Ligue &quot;controla estoque&quot; aqui em cima antes — senão o que for produzido não fica em lugar nenhum.
          </p>
        )}
        <button
          type="button"
          disabled={!controla}
          onClick={() => setEditando(true)}
          className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
        >
          Montar receita
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Receita deste insumo</h3>
          <p className="text-xs text-slate-600">
            1 receita rende <strong>{fmt(rendimento!)} {unidade}</strong> de {produtoNome}
            {custoReceita > 0 && (
              <>
                {' '}· custa {brl(custoReceita)} ({brl(custoUnit)} por {unidade})
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50"
          >
            Editar receita
          </button>
          <Link
            href={`/cadastros/templates-producao/${templateId}`}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-500 hover:bg-slate-50"
          >
            ver template
          </Link>
        </div>
      </div>

      {capacidade && (
        <div
          className={`mt-3 rounded-lg p-3 text-sm ${
            capacidade.receitas >= 1 ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'
          }`}
        >
          Com o estoque de agora dá pra produzir{' '}
          <strong>
            {fmt(capacidade.quantidade, 0)} {unidade}
          </strong>{' '}
          ({fmt(capacidade.receitas, 1)} receita{capacidade.receitas >= 2 ? 's' : ''}).
          {capacidade.limitante && (
            <span className="block text-xs opacity-80">
              Quem acaba primeiro: {capacidade.limitante.nome} (tem {fmt(capacidade.limitante.estoque)}{' '}
              {capacidade.limitante.unidade}, cada receita usa {fmt(capacidade.limitante.quantidade)}{' '}
              {capacidade.limitante.unidade}).
            </span>
          )}
          <span className="block text-xs opacity-80">
            Em estoque de {produtoNome} agora: {fmt(estoqueAtual)} {unidade}.
          </span>
        </div>
      )}

      <table className="mt-3 w-full text-xs">
        <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-1">Ingrediente</th>
            <th className="py-1 text-right">Por receita</th>
            <th className="py-1 text-right">Em estoque</th>
            <th className="py-1 text-right">Dá pra</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => {
            const r = i.quantidade > 0 ? Math.max(0, i.estoque) / i.quantidade : 0;
            return (
              <tr key={i.produtoId} className="border-t border-slate-100">
                <td className="py-1.5">
                  <Link href={`/cadastros/produtos/${i.produtoId}`} className="text-slate-800 hover:underline">
                    {i.nome}
                  </Link>
                </td>
                <td className="py-1.5 text-right font-mono">
                  {fmt(i.quantidade, 3)} {i.unidade}
                </td>
                <td className={`py-1.5 text-right font-mono ${i.estoque <= 0 ? 'text-rose-700' : ''}`}>
                  {fmt(i.estoque, 3)} {i.unidade}
                </td>
                <td className={`py-1.5 text-right ${r < 1 ? 'text-rose-700' : 'text-slate-600'}`}>
                  {fmt(r, 1)} receita{r >= 2 ? 's' : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {semCusto.length > 0 && (
        <p className="mt-1 text-[10px] text-slate-500">
          Sem custo cadastrado: {semCusto.map((i) => i.nome).join(', ')} — o custo da receita sai menor que o real.
        </p>
      )}

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-medium text-slate-800">Produzir agora</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Vou fazer</span>
          <input
            value={qtdProduzir}
            onChange={(e) => setQtdProduzir(e.target.value)}
            inputMode="decimal"
            className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          <span className="text-slate-600">{unidade}</span>
          <span className="text-xs text-slate-400">
            {fator > 0 && `= ${fmt(fator, 2)} receita${fator >= 2 ? 's' : ''}`}
          </span>
        </div>
        {fator > 0 && (
          <p className="mt-2 text-[11px] text-slate-600">
            Vai sair do estoque:{' '}
            {itens.map((i) => `${fmt(i.quantidade * fator, 3)} ${i.unidade} de ${i.nome}`).join(' · ')}
          </p>
        )}
        {faltando.length > 0 && (
          <p className="mt-1 text-[11px] text-amber-800">
            ⚠ O sistema não tem estoque suficiente de {faltando.map((i) => i.nome).join(', ')} — se você tem na
            cozinha, o estoque está desatualizado (vai ficar negativo).
          </p>
        )}
        <div className="mt-2">
          <BotaoConfirmarConversao
            rotulo="Produzir"
            pending={pending || produzindo}
            onConfirmar={produzir}
            resumo={
              fator > 0
                ? `Vão entrar ${fmt(q)} ${unidade} de ${produtoNome} no estoque e sair os ingredientes da receita (× ${fmt(fator, 2)}).`
                : null
            }
          />
        </div>
        {ok && <p className="mt-2 text-xs text-emerald-700">{ok}</p>}
        {erro && <p className="mt-2 text-xs text-rose-700">{erro}</p>}
      </div>
    </div>
  );
}

function EditorReceita({
  produtoId,
  unidade,
  rendimentoInicial,
  itensIniciais,
  temFichaAntiga,
  opcoes,
  onCancelar,
  onSalvo,
}: {
  produtoId: string;
  unidade: string;
  rendimentoInicial: number | null;
  itensIniciais: ItemReceita[];
  temFichaAntiga: boolean;
  opcoes: Opcao[];
  onCancelar: () => void;
  onSalvo: () => void;
}) {
  const [rendimento, setRendimento] = useState(rendimentoInicial ? String(rendimentoInicial) : '');
  const [linhas, setLinhas] = useState(
    itensIniciais.map((i) => ({ produtoId: i.produtoId, nome: i.nome, unidade: i.unidade, qtd: String(i.quantidade) })),
  );
  const [busca, setBusca] = useState('');
  const [apagarFicha, setApagarFicha] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const usados = new Set(linhas.map((l) => l.produtoId));
  const achados = useMemo(() => {
    const b = normalizaBusca(busca);
    if (b.length < 2) return [];
    return opcoes.filter((o) => !usados.has(o.id) && normalizaBusca(o.nome).includes(b)).slice(0, 12);
  }, [busca, opcoes, usados]);

  const r = num(rendimento);
  const validas = linhas.filter((l) => num(l.qtd) > 0);
  const podeSalvar = r > 0 && validas.length > 0 && validas.length === linhas.length;

  async function salvar() {
    setErro(null);
    setSalvando(true);
    const resp = await fetch(`/api/produtos/${produtoId}/receita`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rendimento: r,
        itens: linhas.map((l) => ({ produtoId: l.produtoId, quantidade: num(l.qtd) })),
        apagarFichaAntiga: temFichaAntiga && apagarFicha,
      }),
    });
    const d = await resp.json().catch(() => ({}));
    setSalvando(false);
    if (!resp.ok) {
      setErro(d.error ?? `HTTP ${resp.status}`);
      return;
    }
    onSalvo();
  }

  return (
    <div className="mb-6 space-y-3 rounded-xl border border-slate-300 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-900">Receita deste insumo</h3>
      <p className="text-xs text-slate-600">
        Coloque as quantidades de <strong>uma panelada/receita inteira</strong>, e quanto ela rende.
      </p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-700">1 receita rende</span>
        <input
          value={rendimento}
          onChange={(e) => setRendimento(e.target.value)}
          inputMode="decimal"
          placeholder="ex: 2000"
          className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <span className="text-slate-700">{unidade}</span>
      </div>

      <table className="w-full text-xs">
        <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-1">Ingrediente</th>
            <th className="py-1">Quanto vai na receita</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, idx) => (
            <tr key={l.produtoId} className="border-t border-slate-100">
              <td className="py-1.5 text-slate-800">{l.nome}</td>
              <td className="py-1.5">
                <input
                  value={l.qtd}
                  onChange={(e) =>
                    setLinhas((ls) => ls.map((x, i) => (i === idx ? { ...x, qtd: e.target.value } : x)))
                  }
                  inputMode="decimal"
                  className={`w-24 rounded-md border px-2 py-1 text-xs ${
                    num(l.qtd) > 0 ? 'border-slate-300' : 'border-rose-400'
                  }`}
                />{' '}
                <span className="text-slate-500">{l.unidade}</span>
              </td>
              <td className="py-1.5 text-right">
                <button
                  type="button"
                  onClick={() => setLinhas((ls) => ls.filter((_, i) => i !== idx))}
                  className="text-rose-600 hover:underline"
                >
                  tirar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="+ adicionar ingrediente (digite o nome)"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {achados.length > 0 && (
          <div className="mt-1 max-h-56 overflow-auto rounded-md border border-slate-200">
            {achados.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setLinhas((ls) => [...ls, { produtoId: o.id, nome: o.nome, unidade: o.unidade, qtd: '' }]);
                  setBusca('');
                }}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50"
              >
                {o.nome} <span className="text-slate-400">({o.unidade})</span>
              </button>
            ))}
          </div>
        )}
        <p className="mt-1 text-[10px] text-slate-500">
          A quantidade é na unidade do estoque de cada ingrediente (g, ml, un…).
        </p>
      </div>

      {temFichaAntiga && (
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={apagarFicha} onChange={(e) => setApagarFicha(e.target.checked)} />
          Apagar a ficha técnica antiga deste insumo (ela não baixa nada)
        </label>
      )}

      {erro && <p className="text-xs text-rose-700">{erro}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={!podeSalvar || salvando}
          onClick={salvar}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {salvando ? 'Salvando…' : 'Salvar receita'}
        </button>
      </div>
    </div>
  );
}
