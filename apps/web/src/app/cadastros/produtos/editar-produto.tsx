'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const UNIDADES = ['un', 'ml', 'g', 'kg', 'l'] as const;
const TIPOS = [
  { value: 'VENDA_SIMPLES', label: 'Produto (venda)' },
  { value: 'INSUMO', label: 'Insumo (só compra)' },
  { value: 'COMPLEMENTO', label: 'Complemento' },
  { value: 'COMBO', label: 'Combo' },
  { value: 'VARIANTE', label: 'Produto por tamanho' },
  { value: 'SERVICO', label: 'Serviço (sem estoque)' },
] as const;

interface Produto {
  id: string;
  nome: string | null;
  tipo: string;
  unidadeEstoque: string;
  controlaEstoque: boolean;
  estoqueMinimo: string | null;
  estoqueMaximo: string | null;
  descontinuado: boolean | null;
  criadoNaNuvem: boolean;
  estoqueAtual?: string | null;
  pesoUnitarioPadraoKg?: string | null;
  pesoRelativoProducao?: string | null;
  semTaxaServico?: boolean | null;
  dobradoVale?: boolean | null;
}

export function EditarProdutoButton({ produto }: { produto: Produto }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(produto.nome ?? '');
  const [tipo, setTipo] = useState(produto.tipo);
  const [unidade, setUnidade] = useState(produto.unidadeEstoque);
  const [controla, setControla] = useState(produto.controlaEstoque);
  const [estoqueMinimo, setEstoqueMinimo] = useState(
    produto.estoqueMinimo ? String(Number(produto.estoqueMinimo)) : '',
  );
  const [estoqueMaximo, setEstoqueMaximo] = useState(
    produto.estoqueMaximo ? String(Number(produto.estoqueMaximo)) : '',
  );
  const [descontinuado, setDescontinuado] = useState(produto.descontinuado ?? false);
  const [pesoUn, setPesoUn] = useState(
    produto.pesoUnitarioPadraoKg ? String(Number(produto.pesoUnitarioPadraoKg)) : '',
  );
  const [pesoRel, setPesoRel] = useState(
    produto.pesoRelativoProducao ? String(Number(produto.pesoRelativoProducao)) : '',
  );
  const [semServico, setSemServico] = useState(produto.semTaxaServico ?? false);
  const [dobrado, setDobrado] = useState(produto.dobradoVale ?? false);
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function fechar() {
    setAberto(false);
    setErro(null);
  }

  async function excluir() {
    const saldo = Number(produto.estoqueAtual ?? 0);
    const aviso = saldo !== 0
      ? `Excluir "${produto.nome}"?\n\nO saldo atual e ${saldo} — ajuste pra zero antes de tentar deletar.`
      : `Excluir "${produto.nome}" definitivamente?\n\nSo funciona se o produto nao tiver movimentos historicos nem estiver em ficha tecnica.`;
    if (!confirm(aviso)) return;

    setErro(null);
    try {
      const r = await fetch(`/api/produtos/${produto.id}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      fechar();
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const body: Record<string, unknown> = {};
    if (produto.criadoNaNuvem && nome.trim() && nome.trim() !== produto.nome) {
      body.nome = nome.trim();
    }
    if (tipo !== produto.tipo) body.tipo = tipo;
    if (unidade !== produto.unidadeEstoque) body.unidadeEstoque = unidade;
    if (controla !== produto.controlaEstoque) body.controlaEstoque = controla;
    if (descontinuado !== (produto.descontinuado ?? false)) body.descontinuado = descontinuado;
    if (semServico !== (produto.semTaxaServico ?? false)) body.semTaxaServico = semServico;
    if (dobrado !== (produto.dobradoVale ?? false)) body.dobradoVale = dobrado;

    const minAtual = produto.estoqueMinimo ? Number(produto.estoqueMinimo) : 0;
    const minNovo = estoqueMinimo.trim() ? Number(estoqueMinimo.replace(',', '.')) : 0;
    if (!Number.isFinite(minNovo) || minNovo < 0) {
      setErro('Estoque mínimo inválido');
      return;
    }
    if (minNovo !== minAtual) body.estoqueMinimo = minNovo;

    // Estoque máximo (alvo de reposição) — vazio = limpar (null)
    const maxAtual = produto.estoqueMaximo ? Number(produto.estoqueMaximo) : null;
    const maxNovo = estoqueMaximo.trim() ? Number(estoqueMaximo.replace(',', '.')) : null;
    if (maxNovo !== null && (!Number.isFinite(maxNovo) || maxNovo < 0)) {
      setErro('Estoque máximo inválido');
      return;
    }
    if (maxNovo !== null && minNovo > 0 && maxNovo < minNovo) {
      setErro('Estoque máximo não pode ser menor que o mínimo');
      return;
    }
    if (maxNovo !== maxAtual) body.estoqueMaximo = maxNovo;

    // Peso unitario padrao (kg por un) — null pra limpar
    const pesoUnAtual = produto.pesoUnitarioPadraoKg
      ? Number(produto.pesoUnitarioPadraoKg)
      : null;
    const pesoUnNovo = pesoUn.trim() ? Number(pesoUn.replace(',', '.')) : null;
    if (pesoUnNovo !== null && (!Number.isFinite(pesoUnNovo) || pesoUnNovo <= 0)) {
      setErro('Peso unitário inválido (precisa ser positivo)');
      return;
    }
    if (pesoUnNovo !== pesoUnAtual) body.pesoUnitarioPadraoKg = pesoUnNovo;

    // Peso relativo na produção (rateio do custo da OP) — vazio = sem config
    const pesoRelAtual = produto.pesoRelativoProducao
      ? Number(produto.pesoRelativoProducao)
      : null;
    const pesoRelNovo = pesoRel.trim() ? Number(pesoRel.replace(',', '.')) : null;
    if (pesoRelNovo !== null && (!Number.isFinite(pesoRelNovo) || pesoRelNovo <= 0 || pesoRelNovo > 100)) {
      setErro('Peso na produção inválido (maior que 0, até 100)');
      return;
    }
    if (pesoRelNovo !== pesoRelAtual) body.pesoRelativoProducao = pesoRelNovo;

    if (Object.keys(body).length === 0) {
      fechar();
      return;
    }

    try {
      const r = await fetch(`/api/produtos/${produto.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      fechar();
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
      >
        Editar
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={fechar}
        >
          <form
            onSubmit={enviar}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Editar {produto.nome ?? 'produto'}
              </h2>
              {!produto.criadoNaNuvem && (
                <p className="mt-0.5 text-xs text-slate-500">
                  Nome, preço e código vêm do Consumer — não são editáveis aqui.
                </p>
              )}
            </div>

            {produto.criadoNaNuvem && (
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Nome
                </label>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
            )}

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Tipo
                </label>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  {TIPOS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-24">
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Unidade
                </label>
                <select
                  value={unidade}
                  onChange={(e) => setUnidade(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  {UNIDADES.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Estoque mínimo
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={estoqueMinimo}
                  onChange={(e) => setEstoqueMinimo(e.target.value)}
                  placeholder="0"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Estoque máximo
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={estoqueMaximo}
                  onChange={(e) => setEstoqueMaximo(e.target.value)}
                  placeholder="alvo de reposição"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            {/* Peso unitario padrao — relevante quando produto eh em un mas
                comprado por kg (ex: file vendido em un mas comprado em kg) */}
            {unidade === 'un' && (
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Peso por unidade (kg)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={pesoUn}
                  onChange={(e) => setPesoUn(e.target.value)}
                  placeholder="ex: 1.0 (1 un = 1 kg)"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  Use quando você compra por kg mas vende por un (ex: filé:
                  comprado em kg, virou 1 un = 1 kg). Permite reconciliação
                  automática nas OPs e NFes.
                </p>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Peso na produção (custo)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={pesoRel}
                onChange={(e) => setPesoRel(e.target.value)}
                placeholder="1 (corte comum)"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
              <p className="mt-1 text-[10px] text-slate-500">
                Quanto do custo por kg este produto carrega quando sai de uma ordem de
                produção. 1 = corte comum · 0,3 = subproduto/apara (cada kg vale 30%) ·
                maior que 1 = corte nobre. Em branco = usa o último peso da produção (ou 1).
              </p>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={controla}
                onChange={(e) => setControla(e.target.checked)}
              />
              Controla estoque (gera movimento por compra/venda)
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={descontinuado}
                onChange={(e) => setDescontinuado(e.target.checked)}
              />
              Descontinuado
            </label>

            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={semServico}
                onChange={(e) => setSemServico(e.target.checked)}
              />
              <span>
                Não cobra taxa de serviço (10%)
                <span className="block text-[10px] text-slate-500">
                  Couvert, recreação, ingresso: o item entra na conta, mas fica fora da base dos 10%.
                  Vale pros itens lançados depois que a loja atualizar o cardápio (alguns minutos).
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={dobrado}
                onChange={(e) => setDobrado(e.target.checked)}
              />
              <span>
                Promoção dobrada (paga 1, leva 2)
                <span className="block text-[10px] text-slate-500">
                  Chope dobrado: o 1º sai na hora e o 2º fica de vale na conta até o garçom soltar.
                </span>
              </span>
            </label>

            {erro && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {erro}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              {produto.criadoNaNuvem ? (
                <button
                  type="button"
                  onClick={excluir}
                  disabled={pending}
                  className="text-[11px] text-rose-600 hover:text-rose-800 hover:underline disabled:opacity-50"
                  title="So funciona com saldo 0 e sem movimentos historicos"
                >
                  Excluir produto
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={fechar}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {pending ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
