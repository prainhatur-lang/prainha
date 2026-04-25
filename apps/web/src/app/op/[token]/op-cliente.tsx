'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface Op {
  id: string;
  descricao: string | null;
  observacao: string | null;
  responsavel: string | null;
  status: string;
  marcadaProntaEm: string | null;
  concluidaEm: string | null;
}

interface LinhaEntrada {
  id: string;
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
  observacao: string | null;
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
}: {
  token: string;
  op: Op;
  entradas: LinhaEntrada[];
  saidas: LinhaSaida[];
  produtos: ProdutoOpcao[];
  fotos: Foto[];
}) {
  const editavel = op.status === 'RASCUNHO' && !op.marcadaProntaEm;
  const router = useRouter();
  const [_pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function marcarPronta() {
    if (!confirm('Marcar como pronta? O gestor vai revisar e concluir.')) return;
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch(`/api/op/${token}/marcar-pronta`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
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

      {/* Entradas — instruções */}
      <section className="mt-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
          🥩 Vai usar
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          O gestor reservou esses insumos pra essa produção.
        </p>
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {entradas.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              Nenhum insumo reservado.
            </p>
          ) : (
            entradas.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between border-b border-slate-100 px-4 py-3 last:border-b-0"
              >
                <span className="text-base font-medium text-slate-900">
                  {e.produtoNome}
                </span>
                <span className="font-mono text-base font-bold text-slate-700">
                  {Number(e.quantidade)}{' '}
                  <span className="text-xs font-normal text-slate-500">
                    {e.produtoUnidade}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
      </section>

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
            onClick={marcarPronta}
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
    </div>
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
  const [salvando, setSalvando] = useState(false);
  const ehPerda = saida.tipo === 'PERDA';

  async function salvar() {
    const n = Number(qtd.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      alert('Quantidade inválida');
      return;
    }
    if (n === Number(saida.quantidade)) {
      setEditando(false);
      return;
    }
    setSalvando(true);
    try {
      const r = await fetch(`/api/op/${token}/saida/${saida.id}`, {
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
            <div className="flex items-center gap-1">
              <input
                type="text"
                inputMode="decimal"
                value={qtd}
                onChange={(e) => setQtd(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') salvar();
                  if (e.key === 'Escape') {
                    setQtd(String(Number(saida.quantidade)));
                    setEditando(false);
                  }
                }}
                className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-base"
              />
              <span className="text-xs text-slate-500">{saida.produtoUnidade}</span>
              <button
                type="button"
                onClick={salvar}
                disabled={salvando}
                className="ml-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white"
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
                {Number(saida.quantidade)}
              </p>
              <p className="text-[10px] text-slate-500">{saida.produtoUnidade}</p>
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
  const [erro, setErro] = useState<string | null>(null);
  const [_pending, start] = useTransition();
  const [zoom, setZoom] = useState<Foto | null>(null);

  async function uploadFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setErro('Foto muito grande (máx 10MB)');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append('arquivo', file);
      fd.append('tipo', tipo);
      const r = await fetch(`/api/op/${token}/foto`, { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      start(() => router.refresh());
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
              <span className="text-xs">Enviando...</span>
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
  const [observacao, setObservacao] = useState('');
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
    setTipo('PRODUTO');
    setBusca('');
    setProdutoId('');
    setQtd('');
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
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
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
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
              />
            </div>

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
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
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
