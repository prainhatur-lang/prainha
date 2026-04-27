'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { comprimirImagem, formatBytes } from '@/lib/comprimir-imagem';

interface Op {
  id: string;
  descricao: string | null;
  observacao: string | null;
  responsavel: string | null;
  status: string;
  marcadaProntaEm: string | null;
  marcadaProntaPor: string | null;
  concluidaEm: string | null;
}

interface LinhaEntrada {
  id: string;
  produtoId: string;
  produtoNome: string;
  produtoUnidade: string;
  quantidade: string;
}

interface LinhaSaida {
  id: string;
  tipo: string;
  produtoId: string | null;
  produtoNome: string | null;
  produtoUnidade: string | null;
  quantidade: string;
  pesoRelativo: string;
  pesoTotalKg: string | null;
  observacao: string | null;
}

const TOLERANCIA_DIVERG = 0.05; // 5%

/** Converte qualquer unidade pra kg.
 *  - kg: como está
 *  - g: dividido por 1000
 *  - un/l/ml: usa pesoTotalKg se preenchido, senão NaN (nao da pra contar)
 *  - sem unidade (ex: PERDA sem produto): assume que quantidade ja eh kg */
function quantidadeEmKg(
  quantidade: number,
  unidade: string | null,
  pesoTotalKg: number | null,
): number {
  const u = (unidade ?? '').toLowerCase();
  if (u === 'kg' || u === '') return quantidade;
  if (u === 'g') return quantidade / 1000;
  return pesoTotalKg ?? NaN;
}

interface ProdutoOpcao {
  id: string;
  nome: string;
  unidade: string;
}

interface Foto {
  id: string;
  tipo: string;
  url: string | null;
  observacao: string | null;
  enviadaEm: string | null;
}

export function CozinheiroOp({
  token,
  op,
  entradas,
  saidas,
  produtos,
  fotos,
  sugestoesNomes,
}: {
  token: string;
  op: Op;
  entradas: LinhaEntrada[];
  saidas: LinhaSaida[];
  produtos: ProdutoOpcao[];
  fotos: Foto[];
  sugestoesNomes: string[];
}) {
  const editavel = op.status === 'RASCUNHO' && !op.marcadaProntaEm;
  const router = useRouter();
  const [_pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [modalProntaAberto, setModalProntaAberto] = useState(false);

  async function confirmarPronta(nome: string) {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch(`/api/op/${token}/marcar-pronta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome: nome || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setModalProntaAberto(false);
      start(() => router.refresh());
    } finally {
      setLoading(false);
    }
  }

  async function deletar(saidaId: string, nome: string) {
    if (!confirm(`Remover "${nome}"?`)) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/op/${token}/saida/${saidaId}`, { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(`Erro: ${d.error ?? r.status}`);
        return;
      }
      start(() => router.refresh());
    } finally {
      setLoading(false);
    }
  }

  const saidasProd = saidas.filter((s) => s.tipo === 'PRODUTO');
  const saidasPerda = saidas.filter((s) => s.tipo === 'PERDA');

  // ===== RECONCILIAÇÃO POR PESO =====
  // Soma entrada em kg (cada linha com sua unidade)
  const entradaKg = entradas.reduce((acc, e) => {
    const kg = quantidadeEmKg(Number(e.quantidade), e.produtoUnidade, null);
    return Number.isFinite(kg) ? acc + kg : acc;
  }, 0);

  // Soma saídas (produto) em kg — usa pesoTotalKg quando produto é em un
  const saidaProdKg = saidasProd.reduce((acc, s) => {
    const kg = quantidadeEmKg(
      Number(s.quantidade),
      s.produtoUnidade,
      s.pesoTotalKg ? Number(s.pesoTotalKg) : null,
    );
    return Number.isFinite(kg) ? acc + kg : acc;
  }, 0);

  const perdaKg = saidasPerda.reduce((acc, s) => {
    const kg = quantidadeEmKg(
      Number(s.quantidade),
      s.produtoUnidade,
      s.pesoTotalKg ? Number(s.pesoTotalKg) : null,
    );
    return Number.isFinite(kg) ? acc + kg : acc;
  }, 0);

  const totalSaidaKg = saidaProdKg + perdaKg;
  const divergKg = entradaKg - totalSaidaKg;
  const divergPct = entradaKg > 0 ? Math.abs(divergKg) / entradaKg : 0;
  const fechouOk = entradaKg > 0 && divergPct <= TOLERANCIA_DIVERG;
  const algumaSaidaSemPeso = saidasProd
    .concat(saidasPerda)
    .some((s) => {
      const u = (s.produtoUnidade ?? '').toLowerCase();
      // PERDA sem produto (sem unidade) usa quantidade como kg — nao falta peso
      if (u === '' && s.tipo === 'PERDA') return false;
      // kg/g: quantidade ja eh peso
      if (['kg', 'g'].includes(u)) return false;
      // un/l/ml sem peso: falta peso
      return !s.pesoTotalKg;
    });

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* Header */}
      <div className="rounded-2xl bg-slate-900 p-5 text-white">
        <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
          Ordem de produção
        </p>
        <h1 className="mt-1 text-xl font-bold">
          {op.descricao ?? 'Sem descrição'}
        </h1>
        {op.responsavel && (
          <p className="mt-1 text-sm text-slate-300">
            👨‍🍳 <span className="font-medium">{op.responsavel}</span>
          </p>
        )}
        {op.observacao && (
          <p className="mt-2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200 whitespace-pre-wrap">
            {op.observacao}
          </p>
        )}
        <div className="mt-3">
          {op.concluidaEm ? (
            <span className="inline-block rounded-full bg-emerald-500 px-3 py-1 text-xs font-medium text-white">
              ✓ Concluída pelo gestor
            </span>
          ) : op.marcadaProntaEm ? (
            <span className="inline-block rounded-full bg-amber-500 px-3 py-1 text-xs font-medium text-white">
              ⏳ Aguardando gestor concluir
            </span>
          ) : (
            <span className="inline-block rounded-full bg-sky-500 px-3 py-1 text-xs font-medium text-white">
              📋 Em produção
            </span>
          )}
        </div>
      </div>

      {/* Fotos da entrada (material recebido) */}
      <FotosSection
        token={token}
        tipo="ENTRADA"
        editavel={editavel}
        fotos={fotos.filter((f) => f.tipo === 'ENTRADA')}
        titulo="📷 Foto do material recebido"
        descricao="Tire uma foto do que você recebeu antes de começar."
      />

      {/* Entradas — quanto pegou */}
      <section className="mt-5">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              🥩 Vai usar
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Informe quanto de cada insumo você pegou pra essa produção.
            </p>
          </div>
          {editavel && (
            <AdicionarEntradaBtn token={token} produtos={produtos} />
          )}
        </div>
        <div className="mt-2 space-y-2">
          {entradas.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
              {editavel
                ? 'Adicione o que pegou no estoque (filé, etc.)'
                : 'Nenhum insumo registrado.'}
            </p>
          ) : (
            entradas.map((e) => (
              <EntradaRow key={e.id} token={token} entrada={e} editavel={editavel} />
            ))
          )}
        </div>
      </section>

      {/* Painel de fechamento por peso (só faz sentido se entrada tem peso) */}
      {entradaKg > 0 && (saidasProd.length > 0 || saidasPerda.length > 0) && (
        <section
          className={`mt-5 rounded-2xl border-2 p-4 ${
            algumaSaidaSemPeso
              ? 'border-slate-200 bg-slate-50'
              : fechouOk
                ? 'border-emerald-300 bg-emerald-50'
                : divergPct < 0.10
                  ? 'border-amber-300 bg-amber-50'
                  : 'border-rose-300 bg-rose-50'
          }`}
        >
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
            ⚖ Fechamento por peso
          </h3>
          {algumaSaidaSemPeso ? (
            <p className="mt-1 text-[11px] text-slate-700">
              ⚠ Algum produto saída está em <span className="font-mono">un</span> sem
              peso informado. Edite a saída pra preencher o peso e a OP fechar.
            </p>
          ) : (
            <>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
                <div>
                  <div className="text-slate-500">Entrada</div>
                  <div className="font-mono text-base font-bold text-slate-900">
                    {entradaKg.toFixed(2)} kg
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Produzido</div>
                  <div className="font-mono text-base font-bold text-slate-900">
                    {saidaProdKg.toFixed(2)} kg
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Perda</div>
                  <div className="font-mono text-base font-bold text-slate-900">
                    {perdaKg.toFixed(2)} kg
                  </div>
                </div>
              </div>
              <div className="mt-2 border-t border-slate-200 pt-2 text-center">
                {fechouOk ? (
                  <p className="text-sm font-bold text-emerald-800">
                    ✓ Fechou ({(divergPct * 100).toFixed(1)}% divergência)
                  </p>
                ) : (
                  <p
                    className={`text-sm font-bold ${
                      divergPct < 0.10 ? 'text-amber-800' : 'text-rose-800'
                    }`}
                  >
                    {divergKg > 0 ? '↑' : '↓'} {Math.abs(divergKg).toFixed(2)} kg
                    {' '}({(divergPct * 100).toFixed(1)}% — tolerância 5%)
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {/* Saídas — produtos gerados */}
      <section className="mt-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              ✂ O que vai sair
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Ajuste as quantidades reais. Adicione ou remova conforme necessário.
            </p>
          </div>
          {editavel && (
            <AdicionarSaidaBtn token={token} produtos={produtos} />
          )}
        </div>

        <div className="mt-2 space-y-2">
          {saidasProd.length === 0 && saidasPerda.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
              Nenhum produto cadastrado pelo gestor. Adicione o que produziu.
            </p>
          ) : (
            <>
              {saidasProd.map((s) => (
                <SaidaRow
                  key={s.id}
                  token={token}
                  saida={s}
                  editavel={editavel}
                  onDelete={() => deletar(s.id, s.produtoNome ?? 'item')}
                />
              ))}
              {saidasPerda.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-rose-700">
                    ✕ Perdas
                  </h3>
                  <div className="mt-1 space-y-2">
                    {saidasPerda.map((s) => (
                      <SaidaRow
                        key={s.id}
                        token={token}
                        saida={s}
                        editavel={editavel}
                        onDelete={() =>
                          deletar(s.id, s.produtoNome ?? s.observacao ?? 'perda')
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Fotos da saída (produto pronto) */}
      <FotosSection
        token={token}
        tipo="SAIDA"
        editavel={editavel}
        fotos={fotos.filter((f) => f.tipo === 'SAIDA')}
        titulo="📷 Foto dos produtos prontos"
        descricao="Tire uma foto do que você produziu — cortes, embalagens, etiquetas."
      />

      {/* CTA — Marcar pronta */}
      {editavel && (
        <div className="mt-6 sticky bottom-4">
          <button
            type="button"
            onClick={() => setModalProntaAberto(true)}
            disabled={loading}
            className="w-full rounded-2xl bg-emerald-600 px-6 py-4 text-base font-bold text-white shadow-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? 'Enviando...' : '✓ Marcar como pronta'}
          </button>
          <p className="mt-2 text-center text-xs text-slate-500">
            O gestor vai revisar e concluir oficialmente.
          </p>
          {erro && (
            <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-center text-xs text-rose-800">
              {erro}
            </div>
          )}
        </div>
      )}

      {modalProntaAberto && (
        <ModalQuemMarcouPronta
          sugestoes={sugestoesNomes}
          responsavelOp={op.responsavel}
          loading={loading}
          onConfirmar={confirmarPronta}
          onFechar={() => setModalProntaAberto(false)}
        />
      )}
    </div>
  );
}

function ModalQuemMarcouPronta({
  sugestoes,
  responsavelOp,
  loading,
  onConfirmar,
  onFechar,
}: {
  sugestoes: string[];
  responsavelOp: string | null;
  loading: boolean;
  onConfirmar: (nome: string) => void;
  onFechar: () => void;
}) {
  // Se a OP tem responsavel "Maria, Joao", oferece os 2 como botoes
  const responsaveisDaOp = (responsavelOp ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const [nome, setNome] = useState('');

  // Sugestoes priorizadas: responsaveis da OP primeiro, depois colaboradores ativos
  const opcoesPrioritarias = Array.from(new Set(responsaveisDaOp));
  const opcoesOutras = sugestoes.filter((s) => !opcoesPrioritarias.includes(s));

  function escolher(n: string) {
    onConfirmar(n);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 sm:items-center"
      onClick={onFechar}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-t-2xl border border-slate-200 bg-white p-5 sm:rounded-2xl"
      >
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Quem está marcando como pronta?
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Pra registrar quem fechou a OP. O gestor vê depois.
          </p>
        </div>

        {opcoesPrioritarias.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Responsável da OP
            </p>
            <div className="space-y-2">
              {opcoesPrioritarias.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => escolher(n)}
                  disabled={loading}
                  className="block w-full rounded-xl bg-emerald-600 px-4 py-3 text-left text-base font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Sou {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {opcoesOutras.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Outros cozinheiros
            </p>
            <div className="grid grid-cols-2 gap-2">
              {opcoesOutras.slice(0, 8).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => escolher(n)}
                  disabled={loading}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Ou digite o nome
          </p>
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Seu nome"
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
            />
            <button
              type="button"
              onClick={() => nome.trim() && escolher(nome.trim())}
              disabled={loading || !nome.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              OK
            </button>
          </div>
        </div>

        <div className="flex justify-between border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => escolher('')}
            disabled={loading}
            className="text-xs text-slate-500 hover:underline"
          >
            Pular (sem registrar nome)
          </button>
          <button
            type="button"
            onClick={onFechar}
            disabled={loading}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function EntradaRow({
  token,
  entrada,
  editavel,
}: {
  token: string;
  entrada: LinhaEntrada;
  editavel: boolean;
}) {
  const router = useRouter();
  const [_pending, start] = useTransition();
  const [editando, setEditando] = useState(false);
  const [qtd, setQtd] = useState(String(Number(entrada.quantidade)));
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const n = Number(qtd.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      alert('Quantidade inválida');
      return;
    }
    if (n === Number(entrada.quantidade)) {
      setEditando(false);
      return;
    }
    setSalvando(true);
    try {
      const r = await fetch(`/api/op/${token}/entrada/${entrada.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quantidade: n }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(`Erro: ${d.error ?? r.status}`);
        return;
      }
      setEditando(false);
      start(() => router.refresh());
    } finally {
      setSalvando(false);
    }
  }

  async function remover() {
    if (!confirm(`Remover "${entrada.produtoNome}"?`)) return;
    setSalvando(true);
    try {
      const r = await fetch(`/api/op/${token}/entrada/${entrada.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(`Erro: ${d.error ?? r.status}`);
        return;
      }
      start(() => router.refresh());
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-base font-medium text-slate-900">
          {entrada.produtoNome}
        </span>
        <div className="text-right">
          {editando ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                inputMode="decimal"
                value={qtd}
                onChange={(e) => setQtd(e.target.value)}
                autoFocus
                className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-base"
              />
              <span className="text-xs text-slate-500">{entrada.produtoUnidade}</span>
              <button
                type="button"
                onClick={() => {
                  setQtd(String(Number(entrada.quantidade)));
                  setEditando(false);
                }}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
              >
                ✕
              </button>
              <button
                type="button"
                onClick={salvar}
                disabled={salvando}
                className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white"
              >
                {salvando ? '...' : 'OK'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => editavel && setEditando(true)}
              disabled={!editavel}
              className={`text-right ${editavel ? 'rounded-lg hover:bg-slate-100' : ''} px-2 py-1`}
            >
              <p className="font-mono text-xl font-bold text-slate-900">
                {Number(entrada.quantidade)}
              </p>
              <p className="text-[10px] text-slate-500">{entrada.produtoUnidade}</p>
            </button>
          )}
        </div>
      </div>
      {editavel && !editando && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={remover}
            className="text-[10px] text-rose-600 hover:underline"
          >
            remover
          </button>
        </div>
      )}
    </div>
  );
}

function AdicionarEntradaBtn({
  token,
  produtos,
}: {
  token: string;
  produtos: ProdutoOpcao[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [produtoId, setProdutoId] = useState('');
  const [qtd, setQtd] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [_pending, start] = useTransition();

  const escolhido = produtos.find((p) => p.id === produtoId);

  const opcoes = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return produtos
      .filter((p) => (b ? p.nome.toLowerCase().includes(b) : true))
      .slice(0, 20);
  }, [produtos, busca]);

  function fechar() {
    setAberto(false);
    setBusca('');
    setProdutoId('');
    setQtd('');
    setErro(null);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!produtoId) {
      setErro('Selecione um produto');
      return;
    }
    const n = Number(qtd.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setErro('Quantidade inválida');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/op/${token}/entrada`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ produtoId, quantidade: n }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      fechar();
      start(() => router.refresh());
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
      >
        + Adicionar
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center"
          onClick={fechar}
        >
          <form
            onSubmit={enviar}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-t-2xl border border-slate-200 bg-white p-5 sm:rounded-2xl"
          >
            <h2 className="text-base font-bold text-slate-900">
              Adicionar insumo
            </h2>

            <div>
              <label className="block text-xs font-medium text-slate-600">
                Item *
              </label>
              <input
                type="text"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setProdutoId('');
                }}
                placeholder="Buscar (ex: filé)..."
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
              />
              {busca.trim() && !produtoId && opcoes.length > 0 && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  {opcoes.map((o) => (
                    <button
                      type="button"
                      key={o.id}
                      onClick={() => {
                        setProdutoId(o.id);
                        setBusca(o.nome);
                      }}
                      className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"
                    >
                      <span className="text-slate-800">{o.nome}</span>
                      <span className="font-mono text-xs text-slate-500">{o.unidade}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600">
                Quantidade {escolhido ? `(${escolhido.unidade})` : ''} *
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={qtd}
                onChange={(e) => setQtd(e.target.value)}
                placeholder="0"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
              />
            </div>

            {erro && (
              <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {erro}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={fechar}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvando}
                className="flex-1 rounded-lg bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function SaidaRow({
  token,
  saida,
  editavel,
  onDelete,
}: {
  token: string;
  saida: LinhaSaida;
  editavel: boolean;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [_pending, start] = useTransition();
  const [editando, setEditando] = useState(false);
  const [qtd, setQtd] = useState(String(Number(saida.quantidade)));
  const [pesoKg, setPesoKg] = useState(
    saida.pesoTotalKg ? String(Number(saida.pesoTotalKg)) : '',
  );
  const [salvando, setSalvando] = useState(false);
  const ehPerda = saida.tipo === 'PERDA';
  const precisaPeso = !['kg', 'g'].includes(
    (saida.produtoUnidade ?? '').toLowerCase(),
  );

  async function salvar() {
    const n = Number(qtd.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      alert('Quantidade inválida');
      return;
    }
    let pesoNum: number | null | undefined;
    if (precisaPeso) {
      pesoNum = pesoKg.trim() ? Number(pesoKg.replace(',', '.')) : NaN;
      if (!Number.isFinite(pesoNum) || pesoNum <= 0) {
        alert('Peso em kg inválido — necessário pra fechar a OP');
        return;
      }
    } else {
      pesoNum = undefined; // nao envia
    }
    const qtdMudou = n !== Number(saida.quantidade);
    const pesoMudou =
      pesoNum !== undefined && pesoNum !== Number(saida.pesoTotalKg ?? 0);
    if (!qtdMudou && !pesoMudou) {
      setEditando(false);
      return;
    }
    setSalvando(true);
    try {
      const body: Record<string, unknown> = {};
      if (qtdMudou) body.quantidade = n;
      if (pesoNum !== undefined) body.pesoTotalKg = pesoNum;
      const r = await fetch(`/api/op/${token}/saida/${saida.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(`Erro: ${d.error ?? r.status}`);
        return;
      }
      setEditando(false);
      start(() => router.refresh());
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div
      className={`rounded-xl border-2 p-3 ${
        ehPerda ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-slate-900">
            {saida.produtoNome ?? (
              <span className="italic text-slate-500">
                {saida.observacao ?? '(perda sem item)'}
              </span>
            )}
          </p>
          {Number(saida.pesoRelativo) !== 1 && !ehPerda && (
            <p className="mt-0.5 text-[10px] text-slate-500">
              peso {Number(saida.pesoRelativo)}
            </p>
          )}
        </div>
        <div className="text-right">
          {editando ? (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={qtd}
                  onChange={(e) => setQtd(e.target.value)}
                  autoFocus
                  className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-base"
                />
                <span className="text-xs text-slate-500">
                  {saida.produtoUnidade}
                </span>
              </div>
              {precisaPeso && (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={pesoKg}
                    onChange={(e) => setPesoKg(e.target.value)}
                    placeholder="peso"
                    className="w-20 rounded-md border border-amber-300 px-2 py-1 text-right text-base"
                  />
                  <span className="text-xs text-slate-500">kg</span>
                </div>
              )}
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setQtd(String(Number(saida.quantidade)));
                    setPesoKg(
                      saida.pesoTotalKg ? String(Number(saida.pesoTotalKg)) : '',
                    );
                    setEditando(false);
                  }}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
                >
                  ✕
                </button>
                <button
                  type="button"
                  onClick={salvar}
                  disabled={salvando}
                  className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white"
                >
                  {salvando ? '...' : 'OK'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => editavel && setEditando(true)}
              disabled={!editavel}
              className={`text-right ${editavel ? 'rounded-lg hover:bg-slate-100' : ''} px-2 py-1`}
            >
              <p className="font-mono text-xl font-bold text-slate-900">
                {Number(saida.quantidade)}
              </p>
              <p className="text-[10px] text-slate-500">{saida.produtoUnidade}</p>
              {saida.pesoTotalKg && Number(saida.pesoTotalKg) > 0 && (
                <p className="mt-0.5 font-mono text-[10px] text-slate-600">
                  ={Number(saida.pesoTotalKg).toFixed(2)} kg
                </p>
              )}
              {!saida.pesoTotalKg &&
                !['kg', 'g'].includes(
                  (saida.produtoUnidade ?? '').toLowerCase(),
                ) &&
                editavel && (
                  <p className="mt-0.5 text-[9px] font-medium text-amber-700">
                    ⚠ falta peso
                  </p>
                )}
            </button>
          )}
        </div>
      </div>
      {editavel && !editando && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onDelete}
            className="text-[10px] text-rose-600 hover:underline"
          >
            remover
          </button>
        </div>
      )}
    </div>
  );
}

function FotosSection({
  token,
  tipo,
  editavel,
  fotos,
  titulo,
  descricao,
}: {
  token: string;
  tipo: 'ENTRADA' | 'SAIDA';
  editavel: boolean;
  fotos: Foto[];
  titulo: string;
  descricao: string;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [statusUpload, setStatusUpload] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [_pending, start] = useTransition();
  const [zoom, setZoom] = useState<Foto | null>(null);

  async function uploadFile(file: File) {
    setEnviando(true);
    setErro(null);
    setStatusUpload('Otimizando foto...');
    try {
      // Comprime no client antes de subir (máx 1600px, JPEG q 0.85)
      const r = await comprimirImagem(file);
      const arquivoFinal = r.arquivo;

      if (arquivoFinal.size > 10 * 1024 * 1024) {
        setErro(`Foto muito grande mesmo após otimizar (${formatBytes(arquivoFinal.size)}). Tente outra.`);
        return;
      }

      const stats = r.comprimido
        ? `${formatBytes(r.originalBytes)} → ${formatBytes(r.novosBytes)}`
        : formatBytes(r.originalBytes);
      setStatusUpload(`Enviando... (${stats})`);

      const fd = new FormData();
      fd.append('arquivo', arquivoFinal);
      fd.append('tipo', tipo);
      const resp = await fetch(`/api/op/${token}/foto`, { method: 'POST', body: fd });
      const d = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setErro(d.error ?? `HTTP ${resp.status}`);
        return;
      }
      setStatusUpload(null);
      start(() => router.refresh());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = ''; // reset pra permitir mesma foto de novo
  }

  async function deletar(fotoId: string) {
    if (!confirm('Remover foto?')) return;
    const r = await fetch(`/api/op/${token}/foto/${fotoId}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(`Erro: ${d.error ?? r.status}`);
      return;
    }
    start(() => router.refresh());
  }

  if (!editavel && fotos.length === 0) return null;

  return (
    <section className="mt-5">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
            {titulo}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">{descricao}</p>
        </div>
      </div>

      {/* Galeria + botão de adicionar */}
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {fotos.map((f) =>
          f.url ? (
            <div
              key={f.id}
              className="relative aspect-square overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-100"
            >
              <button
                type="button"
                onClick={() => setZoom(f)}
                className="block h-full w-full"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.url}
                  alt={f.observacao ?? ''}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </button>
              {editavel && (
                <button
                  type="button"
                  onClick={() => deletar(f.id)}
                  className="absolute right-1 top-1 rounded-full bg-rose-600 px-2 py-1 text-[10px] font-medium text-white shadow"
                  aria-label="Remover foto"
                >
                  ✕
                </button>
              )}
            </div>
          ) : null,
        )}

        {editavel && (
          <label
            className={`relative flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center ${
              enviando
                ? 'border-slate-300 bg-slate-50 text-slate-400'
                : 'border-emerald-500 bg-emerald-50 text-emerald-800 active:bg-emerald-100'
            }`}
          >
            {enviando ? (
              <span className="px-2 text-[10px] leading-tight">
                {statusUpload ?? 'Enviando...'}
              </span>
            ) : (
              <>
                <span className="text-3xl">📷</span>
                <span className="mt-1 text-[11px] font-medium">Tirar foto</span>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onChange}
              disabled={enviando}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        )}
      </div>

      {erro && (
        <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {erro}
        </div>
      )}

      {/* Lightbox simples */}
      {zoom && zoom.url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoom.url}
            alt={zoom.observacao ?? ''}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
          <button
            type="button"
            onClick={() => setZoom(null)}
            className="absolute right-4 top-4 rounded-full bg-white/20 px-3 py-1.5 text-sm text-white"
          >
            ✕ Fechar
          </button>
        </div>
      )}
    </section>
  );
}

function AdicionarSaidaBtn({
  token,
  produtos,
}: {
  token: string;
  produtos: ProdutoOpcao[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<'PRODUTO' | 'PERDA'>('PRODUTO');
  const [busca, setBusca] = useState('');
  const [produtoId, setProdutoId] = useState('');
  const [qtd, setQtd] = useState('');
  const [pesoKg, setPesoKg] = useState(''); // peso total em kg quando produto é em un
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [_pending, start] = useTransition();

  const escolhido = produtos.find((p) => p.id === produtoId);
  // Quando precisa pedir peso explicito (campo extra "Peso total kg"):
  //  - PRODUTO em un/l/ml: sempre (pra fechar o painel por peso)
  //  - PERDA com produto em un/l/ml: idem
  //  - PERDA SEM produto: a quantidade EH o peso em kg, nao precisa campo extra
  //  - kg/g: a quantidade ja vira kg automatico, nao precisa campo extra
  const precisaPeso =
    !!escolhido && !['kg', 'g'].includes(escolhido.unidade.toLowerCase());

  // Pra PERDA sem produto, vamos rotular o input "Quantidade" como "Peso (kg)"
  // pra deixar claro que eh peso absoluto.
  const ehPerdaSemProduto = tipo === 'PERDA' && !produtoId;
  const labelQtd = ehPerdaSemProduto
    ? 'Peso (kg) *'
    : `Quantidade ${escolhido ? `(${escolhido.unidade})` : ''} *`;

  const opcoes = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return produtos
      .filter((p) => (b ? p.nome.toLowerCase().includes(b) : true))
      .slice(0, 20);
  }, [produtos, busca]);

  function fechar() {
    setAberto(false);
    setTipo('PRODUTO');
    setBusca('');
    setProdutoId('');
    setQtd('');
    setPesoKg('');
    setObservacao('');
    setErro(null);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(qtd.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setErro('Quantidade inválida');
      return;
    }
    if (tipo === 'PRODUTO' && !produtoId) {
      setErro('Selecione um produto');
      return;
    }
    let pesoNum: number | null = null;
    if (precisaPeso) {
      pesoNum = pesoKg.trim() ? Number(pesoKg.replace(',', '.')) : NaN;
      if (!Number.isFinite(pesoNum) || pesoNum <= 0) {
        setErro('Peso em kg inválido — necessário pra fechar a OP');
        return;
      }
    }
    setSalvando(true);
    setErro(null);
    try {
      const body: Record<string, unknown> = { tipo, quantidade: n };
      if (tipo === 'PRODUTO') {
        body.produtoId = produtoId;
      } else {
        body.produtoId = produtoId || null;
        if (observacao.trim()) body.observacao = observacao.trim();
      }
      if (pesoNum != null) body.pesoTotalKg = pesoNum;
      const r = await fetch(`/api/op/${token}/saida`, {
        method: 'POST',
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
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
      >
        + Adicionar
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center"
          onClick={fechar}
        >
          <form
            onSubmit={enviar}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-t-2xl border border-slate-200 bg-white p-5 sm:rounded-2xl"
          >
            <h2 className="text-base font-bold text-slate-900">Adicionar saída</h2>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTipo('PRODUTO')}
                className={`rounded-xl border-2 px-3 py-3 text-left ${
                  tipo === 'PRODUTO'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                <div className="text-sm font-bold">✓ Produto</div>
                <div className="mt-0.5 text-[10px] opacity-70">vai pro estoque</div>
              </button>
              <button
                type="button"
                onClick={() => setTipo('PERDA')}
                className={`rounded-xl border-2 px-3 py-3 text-left ${
                  tipo === 'PERDA'
                    ? 'border-rose-700 bg-rose-700 text-white'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                <div className="text-sm font-bold">✕ Perda</div>
                <div className="mt-0.5 text-[10px] opacity-70">descarte / aparas</div>
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600">
                Item {tipo === 'PERDA' ? '(opcional)' : '*'}
              </label>
              <input
                type="text"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setProdutoId('');
                }}
                placeholder="Buscar..."
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
              />
              {busca.trim() && !produtoId && opcoes.length > 0 && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  {opcoes.map((o) => (
                    <button
                      type="button"
                      key={o.id}
                      onClick={() => {
                        setProdutoId(o.id);
                        setBusca(o.nome);
                      }}
                      className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"
                    >
                      <span className="text-slate-800">{o.nome}</span>
                      <span className="font-mono text-xs text-slate-500">{o.unidade}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600">
                {labelQtd}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={qtd}
                onChange={(e) => setQtd(e.target.value)}
                placeholder={ehPerdaSemProduto ? '0,00' : '0'}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
              />
              {ehPerdaSemProduto && (
                <p className="mt-1 text-[10px] text-slate-500">
                  Ex: 2,5 kg de aparas/gordura. Entra na conta de fechamento.
                </p>
              )}
            </div>

            {/* Peso total em kg — pedido quando produto eh em un/l/ml,
                pra que o sistema consiga fechar a OP comparando entrada
                em kg com saida em kg + perda em kg. */}
            {precisaPeso && (
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Peso total (kg) *
                </label>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  Quanto pesa, no total, essa quantidade de{' '}
                  {escolhido?.unidade}? Ex: 15 file chateau ≈ 3,75 kg.
                </p>
                <input
                  type="text"
                  inputMode="decimal"
                  value={pesoKg}
                  onChange={(e) => setPesoKg(e.target.value)}
                  placeholder="0,00"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
                />
                {qtd.trim() && pesoKg.trim() && (
                  <p className="mt-1 text-[10px] text-slate-500">
                    ≈{' '}
                    <span className="font-mono font-medium">
                      {(
                        Number(pesoKg.replace(',', '.')) /
                          Number(qtd.replace(',', '.')) || 0
                      ).toFixed(3)}
                    </span>{' '}
                    kg por {escolhido?.unidade}
                  </p>
                )}
              </div>
            )}

            {tipo === 'PERDA' && (
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Motivo da perda
                </label>
                <input
                  type="text"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Ex: gordura, aparas, vencido"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
                />
              </div>
            )}

            {erro && (
              <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {erro}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={fechar}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvando}
                className="flex-1 rounded-lg bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
