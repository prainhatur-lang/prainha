'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LocalEstoque, SaldoProdutoLocal } from '@/lib/estoque-local';

export type TransfHist = {
  id: string;
  produto: string;
  quantidade: number;
  unidade: string;
  origemId: string;
  destinoId: string;
  pessoaNome: string;
  temFoto: boolean;
  observacao: string | null;
  dataHora: string;
  criadoPorEmail: string | null;
  canceladaEm: string | null;
  canceladaPor: string | null;
  motivoCancelamento: string | null;
};

type Aba = 'saldo' | 'transferir' | 'historico' | 'setores';

const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtDataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function EstoqueLocaisCliente(props: {
  filialId: string;
  abaInicial: Aba;
  locais: LocalEstoque[];
  saldos: SaldoProdutoLocal[];
  produtos: { id: string; nome: string; unidade: string }[];
  pessoas: { id: string; nome: string }[];
  historico: TransfHist[];
  podeEditar: boolean;
}) {
  const [aba, setAba] = useState<Aba>(props.abaInicial);
  const nomeLocal = useMemo(() => new Map(props.locais.map((l) => [l.id, l.nome])), [props.locais]);

  const abas: { id: Aba; label: string }[] = [
    { id: 'saldo', label: '📦 Saldo' },
    { id: 'transferir', label: '🔁 Transferir' },
    { id: 'historico', label: '🕘 Histórico' },
    { id: 'setores', label: '⚙️ Setores' },
  ];

  return (
    <div className="mt-4">
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-200 p-1">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            className={`flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
              aba === a.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {aba === 'saldo' && <AbaSaldo locais={props.locais} saldos={props.saldos} />}
        {aba === 'transferir' && (
          <AbaTransferir
            filialId={props.filialId}
            locais={props.locais}
            saldos={props.saldos}
            produtos={props.produtos}
            pessoas={props.pessoas}
            aoConcluir={() => setAba('historico')}
          />
        )}
        {aba === 'historico' && (
          <AbaHistorico historico={props.historico} nomeLocal={nomeLocal} podeEditar={props.podeEditar} />
        )}
        {aba === 'setores' && (
          <AbaSetores filialId={props.filialId} locais={props.locais} podeEditar={props.podeEditar} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Saldo

function AbaSaldo({ locais, saldos }: { locais: LocalEstoque[]; saldos: SaldoProdutoLocal[] }) {
  const [filtro, setFiltro] = useState<string>('todos');
  const [busca, setBusca] = useState('');
  const ativos = locais.filter((l) => l.ativo || saldos.some((s) => (s.porLocal[l.id] ?? 0) !== 0));

  const lista = useMemo(() => {
    const b = semAcento(busca.trim());
    return saldos.filter((s) => {
      if (b && !semAcento(s.nome).includes(b)) return false;
      if (filtro !== 'todos') return (s.porLocal[filtro] ?? 0) !== 0;
      return true;
    });
  }, [saldos, busca, filtro]);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Chip ativo={filtro === 'todos'} onClick={() => setFiltro('todos')}>
          Todos
        </Chip>
        {ativos.map((l) => (
          <Chip key={l.id} ativo={filtro === l.id} onClick={() => setFiltro(l.id)}>
            {l.nome}
            {l.principal ? ' ★' : ''}
          </Chip>
        ))}
      </div>
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar produto…"
        className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"
      />
      <p className="mt-2 text-xs text-slate-500">
        ★ = setor principal: compra, ajuste e produção caem nele. Venda sai primeiro do setor que recebeu o produto.
      </p>

      <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {lista.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">Nada por aqui.</li>}
        {lista.slice(0, 400).map((s) => (
          <li key={s.produtoId} className="px-3 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-slate-900">{s.nome}</span>
              <span className="shrink-0 text-sm tabular-nums text-slate-700">
                {filtro === 'todos' ? fmtQtd(s.total) : fmtQtd(s.porLocal[filtro] ?? 0)} {s.unidade}
              </span>
            </div>
            {filtro === 'todos' && (
              <div className="mt-1 flex flex-wrap gap-1">
                {locais
                  .filter((l) => (s.porLocal[l.id] ?? 0) !== 0)
                  .map((l) => {
                    const v = s.porLocal[l.id] ?? 0;
                    return (
                      <span
                        key={l.id}
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          v < 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {l.nome}: {fmtQtd(v)}
                      </span>
                    );
                  })}
              </div>
            )}
          </li>
        ))}
      </ul>
      {lista.length > 400 && (
        <p className="mt-2 text-xs text-slate-500">Mostrando 400 de {lista.length}. Use a busca.</p>
      )}
    </div>
  );
}

function Chip(props: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`rounded-full border px-3 py-1 text-sm ${
        props.ativo ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
      }`}
    >
      {props.children}
    </button>
  );
}

// ---------------------------------------------------------------- Transferir

function AbaTransferir(props: {
  filialId: string;
  locais: LocalEstoque[];
  saldos: SaldoProdutoLocal[];
  produtos: { id: string; nome: string; unidade: string }[];
  pessoas: { id: string; nome: string }[];
  aoConcluir: () => void;
}) {
  const router = useRouter();
  const ativos = props.locais.filter((l) => l.ativo);
  const principal = ativos.find((l) => l.principal) ?? ativos[0];

  const [busca, setBusca] = useState('');
  const [produtoId, setProdutoId] = useState<string | null>(null);
  const [quantidade, setQuantidade] = useState('');
  const [origemId, setOrigemId] = useState(principal?.id ?? '');
  const [destinoId, setDestinoId] = useState('');
  const [pessoaId, setPessoaId] = useState('');
  const [pessoaNome, setPessoaNome] = useState('');
  const [observacao, setObservacao] = useState('');
  const [foto, setFoto] = useState<Blob | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const produto = props.produtos.find((p) => p.id === produtoId) ?? null;
  const saldoProd = props.saldos.find((s) => s.produtoId === produtoId);
  const sugestoes = useMemo(() => {
    const b = semAcento(busca.trim());
    if (b.length < 2) return [];
    return props.produtos.filter((p) => semAcento(p.nome).includes(b)).slice(0, 25);
  }, [busca, props.produtos]);

  async function enviar() {
    setErro(null);
    setOk(null);
    if (!produto) return setErro('Escolha o produto');
    const q = Number(quantidade.replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) return setErro('Quantidade inválida');
    if (!origemId || !destinoId) return setErro('Escolha de onde sai e pra onde vai');
    if (origemId === destinoId) return setErro('Origem e destino iguais');
    if (!pessoaId && pessoaNome.trim().length < 2) return setErro('Diga quem está levando');
    if (!foto) return setErro('Tire a foto de quem está levando');

    const fd = new FormData();
    fd.set('filialId', props.filialId);
    fd.set('produtoId', produto.id);
    fd.set('quantidade', String(q));
    fd.set('origemId', origemId);
    fd.set('destinoId', destinoId);
    if (pessoaId) fd.set('funcionarioId', pessoaId);
    else fd.set('pessoaNome', pessoaNome.trim());
    if (observacao.trim()) fd.set('observacao', observacao.trim());
    fd.set('foto', foto, 'foto.jpg');

    setEnviando(true);
    try {
      const r = await fetch('/api/estoque/transferencia-local', { method: 'POST', body: fd });
      const j = (await r.json().catch(() => ({}))) as { error?: string; aviso?: string | null };
      if (!r.ok) {
        setErro(j.error ?? 'Não consegui registrar');
        return;
      }
      const nomeO = props.locais.find((l) => l.id === origemId)?.nome;
      const nomeD = props.locais.find((l) => l.id === destinoId)?.nome;
      setOk(`✅ ${fmtQtd(q)} ${produto.unidade} de ${produto.nome}: ${nomeO} → ${nomeD}.${j.aviso ? ` ${j.aviso}` : ''}`);
      setProdutoId(null);
      setBusca('');
      setQuantidade('');
      setObservacao('');
      setFoto(null);
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      {ok && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {ok}{' '}
          <button type="button" className="underline" onClick={props.aoConcluir}>
            Ver histórico
          </button>
        </div>
      )}

      <Bloco titulo="1. Produto">
        {produto ? (
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium text-slate-900">{produto.nome}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {props.locais
                  .filter((l) => (saldoProd?.porLocal[l.id] ?? 0) !== 0)
                  .map((l) => (
                    <span key={l.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                      {l.nome}: {fmtQtd(saldoProd?.porLocal[l.id] ?? 0)} {produto.unidade}
                    </span>
                  ))}
                {!saldoProd && <span className="text-xs text-slate-500">Sem saldo no sistema</span>}
              </div>
            </div>
            <button type="button" className="text-sm text-sky-700 underline" onClick={() => setProdutoId(null)}>
              trocar
            </button>
          </div>
        ) : (
          <>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Digite o nome do produto…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
            {sugestoes.length > 0 && (
              <ul className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {sugestoes.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setProdutoId(p.id)}
                      className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span>{p.nome}</span>
                      <span className="text-slate-400">{p.unidade}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Bloco>

      <Bloco titulo={`2. Quantidade${produto ? ` (${produto.unidade})` : ''}`}>
        <input
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
          inputMode="decimal"
          placeholder="0"
          className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-lg tabular-nums"
        />
      </Bloco>

      <Bloco titulo="3. Sai de">
        <div className="flex flex-wrap gap-2">
          {ativos.map((l) => (
            <Chip key={l.id} ativo={origemId === l.id} onClick={() => setOrigemId(l.id)}>
              {l.nome}
            </Chip>
          ))}
        </div>
      </Bloco>

      <Bloco titulo="4. Vai para">
        <div className="flex flex-wrap gap-2">
          {ativos
            .filter((l) => l.id !== origemId)
            .map((l) => (
              <Chip key={l.id} ativo={destinoId === l.id} onClick={() => setDestinoId(l.id)}>
                {l.nome}
              </Chip>
            ))}
        </div>
      </Bloco>

      <Bloco titulo="5. Quem está levando">
        <select
          value={pessoaId}
          onChange={(e) => setPessoaId(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"
        >
          <option value="">— outra pessoa (digitar o nome) —</option>
          {props.pessoas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
        {!pessoaId && (
          <input
            value={pessoaNome}
            onChange={(e) => setPessoaNome(e.target.value)}
            placeholder="Nome de quem está levando"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        )}
      </Bloco>

      <Bloco titulo="6. Foto de quem está levando">
        <Camera foto={foto} setFoto={setFoto} />
      </Bloco>

      <Bloco titulo="Observação (opcional)">
        <input
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
      </Bloco>

      {erro && <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{erro}</div>}

      <button
        type="button"
        disabled={enviando}
        onClick={enviar}
        className="w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
      >
        {enviando ? 'Registrando…' : 'Registrar transferência'}
      </button>
    </div>
  );
}

function Bloco(props: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{props.titulo}</h2>
      {props.children}
    </section>
  );
}

/** Câmera frontal do celular/tablet. Se o navegador não liberar a câmera,
 *  cai no seletor de foto do aparelho (capture="user"). */
function Camera({ foto, setFoto }: { foto: Blob | null; setFoto: (b: Blob | null) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ligada, setLigada] = useState(false);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!foto) {
      setPreview(null);
      return;
    }
    const u = URL.createObjectURL(foto);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [foto]);

  useEffect(() => () => parar(), []);

  function parar() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLigada(false);
  }

  async function ligar() {
    setFalhou(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = s;
      setLigada(true);
      setFoto(null);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => {});
        }
      });
    } catch {
      setFalhou('Não consegui abrir a câmera. Use o botão abaixo pra tirar a foto pelo aparelho.');
    }
  }

  function bater() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const max = 1024;
    const esc = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * esc);
    c.height = Math.round(v.videoHeight * esc);
    c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(
      (b) => {
        if (b) {
          setFoto(b);
          parar();
        }
      },
      'image/jpeg',
      0.8,
    );
  }

  if (preview) {
    return (
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt="Foto" className="h-28 w-28 rounded-lg object-cover" />
        <button type="button" onClick={() => setFoto(null)} className="text-sm text-sky-700 underline">
          Tirar outra
        </button>
      </div>
    );
  }

  return (
    <div>
      {ligada ? (
        <div className="space-y-2">
          <video ref={videoRef} playsInline muted className="w-full max-w-sm -scale-x-100 rounded-lg bg-black" />
          <div className="flex gap-2">
            <button type="button" onClick={bater} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white">
              📸 Bater foto
            </button>
            <button type="button" onClick={parar} className="rounded-lg border border-slate-300 px-4 py-2 text-slate-700">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={ligar} className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white">
          📷 Abrir câmera
        </button>
      )}
      {falhou && <p className="mt-2 text-sm text-amber-700">{falhou}</p>}
      <label className="mt-2 block text-sm text-slate-600">
        <span className="underline">ou usar a câmera do aparelho</span>
        <input
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setFoto(f);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- Histórico

function AbaHistorico(props: { historico: TransfHist[]; nomeLocal: Map<string, string>; podeEditar: boolean }) {
  const router = useRouter();
  const [busca, setBusca] = useState('');
  const [fotoGrande, setFotoGrande] = useState<string | null>(null);
  const lista = useMemo(() => {
    const b = semAcento(busca.trim());
    if (!b) return props.historico;
    return props.historico.filter((h) => semAcento(`${h.produto} ${h.pessoaNome}`).includes(b));
  }, [busca, props.historico]);

  async function cancelar(id: string) {
    const motivo = window.prompt('Motivo do cancelamento:');
    if (!motivo || motivo.trim().length < 3) return;
    const r = await fetch('/api/estoque/transferencia-local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acao: 'cancelar', id, motivo: motivo.trim() }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) window.alert(j.error ?? 'Não consegui cancelar');
    router.refresh();
  }

  return (
    <div>
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar produto ou pessoa…"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"
      />
      <ul className="mt-3 space-y-2">
        {lista.length === 0 && <li className="py-6 text-center text-sm text-slate-500">Nenhuma transferência ainda.</li>}
        {lista.map((h) => (
          <li
            key={h.id}
            className={`flex gap-3 rounded-lg border bg-white p-3 ${
              h.canceladaEm ? 'border-slate-200 opacity-60' : 'border-slate-200'
            }`}
          >
            {h.temFoto ? (
              <button type="button" onClick={() => setFotoGrande(h.id)} className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/estoque/transferencia-local?foto=${h.id}`}
                  alt={h.pessoaNome}
                  loading="lazy"
                  className="h-16 w-16 rounded-lg object-cover"
                />
              </button>
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">
                sem foto
              </div>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <div className={`font-medium text-slate-900 ${h.canceladaEm ? 'line-through' : ''}`}>
                {fmtQtd(h.quantidade)} {h.unidade} · {h.produto}
              </div>
              <div className="text-slate-700">
                {props.nomeLocal.get(h.origemId) ?? '?'} → {props.nomeLocal.get(h.destinoId) ?? '?'}
              </div>
              <div className="text-slate-500">
                {h.pessoaNome} · {fmtDataHora(h.dataHora)}
                {h.criadoPorEmail ? ` · lançado por ${h.criadoPorEmail}` : ''}
              </div>
              {h.observacao && <div className="text-slate-500">“{h.observacao}”</div>}
              {h.canceladaEm ? (
                <div className="text-rose-700">
                  Cancelada {fmtDataHora(h.canceladaEm)} por {h.canceladaPor}: {h.motivoCancelamento}
                </div>
              ) : (
                props.podeEditar && (
                  <button type="button" onClick={() => cancelar(h.id)} className="mt-1 text-xs text-rose-700 underline">
                    cancelar
                  </button>
                )
              )}
            </div>
          </li>
        ))}
      </ul>

      {fotoGrande && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setFotoGrande(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/estoque/transferencia-local?foto=${fotoGrande}`}
            alt="Foto"
            className="max-h-full max-w-full rounded-lg"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Setores

function AbaSetores(props: { filialId: string; locais: LocalEstoque[]; podeEditar: boolean }) {
  const router = useRouter();
  const [novo, setNovo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function chamar(body: Record<string, unknown>) {
    setErro(null);
    setOcupado(true);
    try {
      const r = await fetch('/api/estoque/locais', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setErro(j.error ?? 'Não consegui salvar');
      router.refresh();
      return r.ok;
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-3">
      {!props.podeEditar && (
        <p className="text-sm text-slate-500">Só quem pode editar produto cadastra setores.</p>
      )}
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {props.locais.map((l, i) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className={`flex-1 font-medium ${l.ativo ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
              {l.nome}
              {l.principal && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">principal ★</span>
              )}
            </span>
            {props.podeEditar && (
              <div className="flex flex-wrap gap-1 text-xs">
                <Mini disabled={ocupado || i === 0} onClick={() => chamar({ acao: 'mover', id: l.id, direcao: 'cima' })}>
                  ↑
                </Mini>
                <Mini
                  disabled={ocupado || i === props.locais.length - 1}
                  onClick={() => chamar({ acao: 'mover', id: l.id, direcao: 'baixo' })}
                >
                  ↓
                </Mini>
                <Mini
                  disabled={ocupado}
                  onClick={() => {
                    const n = window.prompt('Novo nome do setor:', l.nome);
                    if (n && n.trim() && n.trim() !== l.nome) void chamar({ acao: 'renomear', id: l.id, nome: n.trim() });
                  }}
                >
                  renomear
                </Mini>
                {!l.principal && l.ativo && (
                  <Mini disabled={ocupado} onClick={() => chamar({ acao: 'principal', id: l.id })}>
                    tornar principal
                  </Mini>
                )}
                {!l.principal && (
                  <Mini
                    disabled={ocupado}
                    onClick={() => chamar({ acao: l.ativo ? 'desativar' : 'ativar', id: l.id })}
                  >
                    {l.ativo ? 'desativar' : 'ativar'}
                  </Mini>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {props.podeEditar && (
        <div className="flex gap-2">
          <input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Novo setor (ex.: Câmara fria)"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"
          />
          <button
            type="button"
            disabled={ocupado || novo.trim().length < 2}
            onClick={async () => {
              if (await chamar({ acao: 'criar', filialId: props.filialId, nome: novo.trim() })) setNovo('');
            }}
            className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>
      )}
      {erro && <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{erro}</div>}
      <p className="text-xs text-slate-500">
        O setor principal é onde cai a compra, o ajuste e a produção. Setor desativado some da transferência, mas o
        histórico continua.
      </p>
    </div>
  );
}

function Mini(props: { disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="rounded border border-slate-300 px-2 py-1 text-slate-700 disabled:opacity-40"
    >
      {props.children}
    </button>
  );
}
