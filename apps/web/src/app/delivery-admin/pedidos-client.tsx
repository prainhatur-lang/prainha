'use client';

// Fila de pedidos do delivery. Polling de 5s pra detectar pedido pago novo:
// toca o sino (AudioContext, sem arquivo de áudio) e recarrega a lista.

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface ItemPedido {
  pedidoId: string;
  nome: string;
  qtd: number;
  total: string;
  obs: string | null;
  complementos: Array<{ nome: string; precoCentavos: number }> | null;
}

interface Pedido {
  id: string;
  numero: number;
  filialId: string;
  clienteNome: string;
  clienteTelefone: string;
  tipo: string;
  endereco: {
    rua?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    referencia?: string;
  } | null;
  distanciaKm: string | null;
  agendadoData: string;
  agendadoHora: string | null;
  asap: boolean;
  subtotal: string;
  taxaEntrega: string;
  desconto: string;
  total: string;
  cupomCodigo: string | null;
  freteGratisMotivo: string | null;
  status: string;
  pagamentoMetodo: string | null;
  observacao: string | null;
  canceladoMotivo: string | null;
  criadoEm: string;
  pagoEm: string | null;
  /** Primeira vez em cada status (trigger do banco) — ISO. */
  statusEm?: Record<string, string> | null;
  itens: ItemPedido[];
}

interface Props {
  pedidos: Pedido[];
  filiais: Array<{ id: string; nome: string }>;
  filialFiltro: string | null;
  podeAtualizar: boolean;
  podeConfigurar: boolean;
  /** Casas onde o usuário é DONO/GERENTE (cancela pedido concluído). */
  gerenteEm?: string[];
  lojas: Array<{ id: string; slug: string | null; ativo: boolean; pausado: boolean }>;
}

const STATUS_INFO: Record<string, { txt: string; cls: string }> = {
  pendente_pagamento: { txt: 'Aguardando pagamento', cls: 'bg-slate-100 text-slate-600' },
  pago: { txt: 'Novo — pago', cls: 'bg-emerald-100 text-emerald-700' },
  em_preparo: { txt: 'Na cozinha', cls: 'bg-amber-100 text-amber-800' },
  pronto: { txt: 'Pronto', cls: 'bg-sky-100 text-sky-700' },
  saiu_entrega: { txt: 'Saiu pra entrega', cls: 'bg-violet-100 text-violet-700' },
  chegou: { txt: 'Entregador na porta', cls: 'bg-violet-100 text-violet-800' },
  concluido: { txt: 'Concluído', cls: 'bg-slate-100 text-slate-500' },
  cancelado: { txt: 'Cancelado', cls: 'bg-rose-100 text-rose-700' },
};

const metodoTxt = (m: string | null) => (m === 'pix' ? 'Pix' : m === 'na_entrega' ? 'na entrega' : 'cartão');

const brl = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function hhmm(ts: string | null): string {
  if (!ts) return '';
  const m = ts.match(/\d{2}:\d{2}/);
  return m ? m[0] : '';
}

function fmtData(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

export function PedidosClient({
  pedidos,
  filiais,
  filialFiltro,
  podeAtualizar,
  podeConfigurar,
  gerenteEm = [],
  lojas,
}: Props) {
  const router = useRouter();
  const [, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [somLigado, setSomLigado] = useState(true);
  const [novos, setNovos] = useState<string[]>([]);
  const desdeRef = useRef(new Date().toISOString());

  // Sino + refresh quando entra pedido pago
  useEffect(() => {
    let cancel = false;

    function tocarSino() {
      if (!somLigado) return;
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const bip = (freq: number, atraso: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.22, ctx.currentTime + atraso);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + atraso + 0.5);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + atraso);
          osc.stop(ctx.currentTime + atraso + 0.5);
        };
        bip(880, 0);
        bip(1174, 0.22);
        bip(1568, 0.44);
      } catch {
        /* navegador sem AudioContext ou bloqueou — segue com o aviso visual */
      }
    }

    async function poll() {
      try {
        const r = await fetch(
          `/api/delivery-admin/novos?desde=${encodeURIComponent(desdeRef.current)}`,
          { cache: 'no-store' },
        );
        if (!r.ok) return;
        const d = await r.json();
        if (cancel) return;
        if (typeof d?.agora === 'string') desdeRef.current = d.agora;
        if (Array.isArray(d?.novos) && d.novos.length > 0) {
          tocarSino();
          setNovos((prev) => [
            ...prev,
            ...d.novos.map(
              (n: { numero: number; clienteNome: string; total: string }) =>
                `🔔 Pedido #${n.numero} — ${n.clienteNome} · ${brl(n.total)}`,
            ),
          ]);
          start(() => router.refresh());
        }
      } catch {
        /* rede oscilou — tenta no próximo ciclo */
      }
    }

    const t = setInterval(poll, 5000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, [router, somLigado]);

  async function acao(id: string, tipo: string, motivo?: string) {
    setErro(null);
    setMsg(null);
    const r = await fetch(`/api/delivery-admin/pedido/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: tipo, motivo }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(d.error ?? `Erro ${r.status}`);
      return;
    }
    setMsg(
      tipo === 'cancelar'
        ? d.estorno === 'ok'
          ? 'Pedido cancelado e valor estornado.'
          : d.estorno === 'falhou'
            ? 'Pedido cancelado, mas o estorno na Cielo falhou — faça manualmente.'
            : 'Pedido cancelado.'
        : 'Pedido atualizado.',
    );
    start(() => router.refresh());
  }

  async function pausar(filialId: string, pausar: boolean) {
    setErro(null);
    const r = await fetch(`/api/delivery-admin/config?filialId=${filialId}`, { cache: 'no-store' });
    const atual = await r.json().catch(() => ({}));
    if (!r.ok || !atual.config) {
      setErro('Não consegui ler a configuração da loja.');
      return;
    }
    const put = await fetch('/api/delivery-admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...atual.config, filialId, pausado: pausar }),
    });
    if (!put.ok) {
      const d = await put.json().catch(() => ({}));
      setErro(d.error ?? 'Não consegui pausar a loja.');
      return;
    }
    setMsg(pausar ? 'Delivery pausado — o site parou de aceitar pedidos.' : 'Delivery retomado.');
    start(() => router.refresh());
  }

  const abertos = pedidos.filter((p) =>
    ['pago', 'em_preparo', 'pronto', 'saiu_entrega'].includes(p.status),
  );
  const encerrados = pedidos.filter((p) => ['concluido', 'cancelado'].includes(p.status));
  const pendentes = pedidos.filter((p) => p.status === 'pendente_pagamento');

  return (
    <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Delivery — pedidos</h1>
          <p className="text-sm text-slate-500">
            {abertos.length} em andamento · atualiza sozinho a cada 5 segundos
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSomLigado((s) => !s)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              somLigado ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {somLigado ? '🔔 Som ligado' : '🔕 Som desligado'}
          </button>
          <Link
            href="/delivery-admin/cardapio"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cardápio
          </Link>
          <Link
            href="/delivery-admin/cupons"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cupons
          </Link>
          {podeConfigurar ? (
            <Link
              href="/delivery-admin/config"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Configurar
            </Link>
          ) : null}
        </div>
      </div>

      {/* filtro de filial + status da loja */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {filiais.length > 1 ? (
          <>
            <Link
              href="/delivery-admin"
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                !filialFiltro ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
              }`}
            >
              Todas
            </Link>
            {filiais.map((fil) => (
              <Link
                key={fil.id}
                href={`/delivery-admin?f=${fil.id}`}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  filialFiltro === fil.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200'
                }`}
              >
                {fil.nome}
              </Link>
            ))}
          </>
        ) : null}
        {lojas
          .filter((l) => l.ativo && (!filialFiltro || l.id === filialFiltro))
          .map((l) => (
            <span key={l.id} className="flex items-center gap-2">
              <a
                href={`/delivery/${l.slug}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-white px-3 py-1 text-xs font-medium text-sky-700 underline ring-1 ring-slate-200"
              >
                ver a loja ↗
              </a>
              {podeConfigurar ? (
                <button
                  onClick={() => void pausar(l.id, !l.pausado)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    l.pausado
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-white text-slate-600 ring-1 ring-slate-200'
                  }`}
                >
                  {l.pausado ? '▶︎ Retomar pedidos' : '⏸ Pausar pedidos'}
                </button>
              ) : null}
            </span>
          ))}
      </div>

      {novos.length > 0 ? (
        <div className="mt-3 space-y-1">
          {novos.map((n, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow"
            >
              <span>{n}</span>
              <button
                onClick={() => setNovos((prev) => prev.filter((_, idx) => idx !== i))}
                className="ml-3 text-white/80"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {msg ? (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">{msg}</p>
      ) : null}
      {erro ? (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{erro}</p>
      ) : null}

      {/* fila */}
      {abertos.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          Nenhum pedido em andamento. Assim que entrar um pedido pago, ele aparece aqui e o sino
          toca.
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {abertos.map((p) => (
            <CardPedido key={p.id} p={p} podeAtualizar={podeAtualizar} onAcao={acao} />
          ))}
        </div>
      )}

      {pendentes.length > 0 ? (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Aguardando pagamento ({pendentes.length})
          </h2>
          <div className="mt-2 space-y-1.5">
            {pendentes.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span className="text-slate-600">
                  #{p.numero} · {p.clienteNome} · {brl(p.total)} ·{' '}
                  {metodoTxt(p.pagamentoMetodo)}
                </span>
                <span className="text-xs text-slate-400">{hhmm(p.criadoEm)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {encerrados.length > 0 ? (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Encerrados (últimos dias)
          </h2>
          <div className="mt-2 space-y-1.5">
            {encerrados.map((p) => (
              <LinhaEncerrado
                key={p.id}
                p={p}
                podeAtualizar={podeAtualizar}
                ehGerente={gerenteEm.includes(p.filialId)}
                onCancelado={(texto) => {
                  setErro(null);
                  setMsg(texto);
                  start(() => router.refresh());
                }}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

const ETAPAS_TXT: Array<[string, string]> = [
  ['pendente_pagamento', 'Pedido feito'],
  ['pago', 'Pago'],
  ['em_preparo', 'Na cozinha'],
  ['pronto', 'Pronto'],
  ['saiu_entrega', 'Saiu pra entrega'],
  ['chegou', 'Entregador na porta'],
  ['concluido', 'Concluído'],
  ['cancelado', 'Cancelado'],
];

/** Detalhe de pedido encerrado (concluído/cancelado), só leitura — dono
 *  22/11/2026 ('quando clicar, mesmo com o pedido concluído, saber o que foi,
 *  quem é o cliente, qual é o endereço'). Sem botões de mudar status. */
function LinhaEncerrado({
  p,
  podeAtualizar,
  ehGerente,
  onCancelado,
}: {
  p: Pedido;
  podeAtualizar: boolean;
  ehGerente: boolean;
  onCancelado: (texto: string) => void;
}) {
  // Só monta o detalhe quando abre (o entregador/nota buscam dados no mount).
  const [aberto, setAberto] = useState(false);
  return (
    <details
      className="group rounded-lg border border-slate-200 bg-white text-sm open:shadow-sm"
      onToggle={(e) => setAberto((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span className="text-slate-600">
          <span className="mr-1 inline-block text-slate-400 transition-transform group-open:rotate-90">›</span>
          #{p.numero} · {p.clienteNome} · {brl(p.total)}
          {p.canceladoMotivo ? <span className="ml-1 text-xs text-rose-600">({p.canceladoMotivo})</span> : null}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_INFO[p.status]?.cls ?? ''}`}
        >
          {STATUS_INFO[p.status]?.txt ?? p.status}
        </span>
      </summary>
      {aberto ? (
        <DetalheEncerrado p={p} podeAtualizar={podeAtualizar} ehGerente={ehGerente} onCancelado={onCancelado} />
      ) : null}
    </details>
  );
}

/** Cancelar pedido JÁ CONCLUÍDO — só gerente/dono da casa. Escolhe se vira
 *  devolução do dinheiro, crédito pro cliente (cupom CRED-…) ou nada. */
function CancelarConcluido({ p, onCancelado }: { p: Pedido; onCancelado: (texto: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [destino, setDestino] = useState<'credito' | 'devolucao' | 'nenhum'>('credito');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const pagoOnline = p.pagamentoMetodo !== 'na_entrega';

  async function confirmar() {
    if (!motivo.trim()) {
      setErro('Escreva o motivo.');
      return;
    }
    const txt =
      destino === 'credito'
        ? `gerar crédito de ${brl(p.total)} pro cliente`
        : destino === 'devolucao'
          ? `devolver ${brl(p.total)} ao cliente`
          : 'cancelar sem crédito nem devolução';
    if (!window.confirm(`Cancelar o pedido #${p.numero} e ${txt}?`)) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch(`/api/delivery-admin/pedido/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'cancelar_concluido', destino, motivo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      onCancelado(
        d.credito
          ? `Pedido #${p.numero} cancelado. Crédito ${d.credito} de ${brl(p.total)} enviado ao cliente no WhatsApp.`
          : d.estorno === 'ok'
            ? `Pedido #${p.numero} cancelado e valor devolvido (estorno feito).`
            : d.estorno === 'falhou'
              ? `Pedido #${p.numero} cancelado, mas o estorno automático falhou — devolva ${brl(p.total)} à mão.`
              : d.estorno === 'manual'
                ? `Pedido #${p.numero} cancelado — devolva ${brl(p.total)} ao cliente à mão (não foi pago online).`
                : `Pedido #${p.numero} cancelado.`,
      );
    } finally {
      setOcupado(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="rounded-md border border-rose-200 bg-white px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
      >
        Cancelar pedido (gerente)
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/50 p-3">
      <p className="text-sm font-semibold text-rose-800">Cancelar pedido #{p.numero} — {brl(p.total)}</p>
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Motivo (o cliente recebe no WhatsApp) — ex.: pedido chegou errado"
        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
      />
      <div className="space-y-1 text-sm text-slate-700">
        <label className="flex items-start gap-2">
          <input type="radio" checked={destino === 'credito'} onChange={() => setDestino('credito')} className="mt-1" />
          <span>
            <b>Crédito pro cliente</b> — gera um cupom de {brl(p.total)} (1 uso, 90 dias) e manda o código no WhatsApp
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" checked={destino === 'devolucao'} onChange={() => setDestino('devolucao')} className="mt-1" />
          <span>
            <b>Devolver o dinheiro</b> —{' '}
            {pagoOnline ? 'estorna no Pix/cartão em que ele pagou' : 'foi pago na entrega: a devolução é feita à mão'}
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" checked={destino === 'nenhum'} onChange={() => setDestino('nenhum')} className="mt-1" />
          <span>
            <b>Só cancelar</b> — sem crédito nem devolução
          </span>
        </label>
      </div>
      <p className="text-xs text-slate-500">
        A nota fiscal (se saiu) não é cancelada sozinha — confira em Fiscal. O Pix do entregador não volta.
      </p>
      {erro ? <p className="text-xs text-rose-700">{erro}</p> : null}
      <div className="flex gap-2">
        <button
          disabled={ocupado}
          onClick={confirmar}
          className="rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {ocupado ? 'Cancelando…' : 'Confirmar cancelamento'}
        </button>
        <button
          disabled={ocupado}
          onClick={() => setAberto(false)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
        >
          Voltar
        </button>
      </div>
    </div>
  );
}

function DetalheEncerrado({
  p,
  podeAtualizar,
  ehGerente,
  onCancelado,
}: {
  p: Pedido;
  podeAtualizar: boolean;
  ehGerente: boolean;
  onCancelado: (texto: string) => void;
}) {
  const etapas = ETAPAS_TXT.filter(([k]) => p.statusEm?.[k]).map(([k, txt]) => ({
    txt,
    em: p.statusEm![k]!,
  }));
  const quando = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  const e = p.endereco;
  return (
    <div className="space-y-3 border-t border-slate-100 px-3 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cliente</p>
          <p className="font-medium text-slate-900">{p.clienteNome}</p>
          <p className="text-slate-600">
            {p.clienteTelefone}{' '}
            <a
              href={`https://wa.me/${p.clienteTelefone}?text=${encodeURIComponent(`Oi ${p.clienteNome.split(' ')[0]}! Sobre seu pedido #${p.numero}:`)}`}
              target="_blank"
              rel="noreferrer"
              className="ml-1 text-xs text-emerald-700 underline"
            >
              WhatsApp
            </a>
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {p.tipo === 'entrega' ? '🛵 Entrega' : '🏖️ Retirada'}
          </p>
          {p.tipo === 'entrega' && e ? (
            <p className="text-slate-700">
              {e.rua}, {e.numero}
              {e.complemento ? ` — ${e.complemento}` : ''}
              {e.bairro ? ` · ${e.bairro}` : ''}
              {e.referencia ? <span className="block text-xs text-slate-500">ref: {e.referencia}</span> : null}
              {p.distanciaKm ? (
                <span className="block text-xs text-slate-500">
                  {Number(p.distanciaKm).toFixed(1).replace('.', ',')} km
                </span>
              ) : null}
            </p>
          ) : (
            <p className="text-slate-600">Cliente busca na loja</p>
          )}
          <p className="text-xs text-slate-500">
            {p.asap ? `O quanto antes (${hhmm(p.pagoEm ?? p.criadoEm)})` : `Agendado: ${fmtData(p.agendadoData)} às ${p.agendadoHora}`}
          </p>
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Itens</p>
        <ul className="mt-1 space-y-1">
          {p.itens.length === 0 ? <li className="text-slate-400">Sem itens gravados</li> : null}
          {p.itens.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-2">
              <span className="text-slate-700">
                <span className="font-semibold">{i.qtd}×</span> {i.nome}
                {i.complementos?.length ? (
                  <span className="block text-xs text-sky-700">↳ {i.complementos.map((c) => c.nome).join(', ')}</span>
                ) : null}
                {i.obs ? <span className="block text-xs text-amber-700">↳ {i.obs}</span> : null}
              </span>
              <span className="shrink-0 text-slate-500">{brl(i.total)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2">
          <div className="flex justify-between text-slate-500">
            <span>Subtotal</span>
            <span>{brl(p.subtotal)}</span>
          </div>
          {Number(p.desconto) > 0 ? (
            <div className="flex justify-between text-emerald-700">
              <span>Cupom {p.cupomCodigo ?? ''}</span>
              <span>− {brl(p.desconto)}</span>
            </div>
          ) : null}
          {p.tipo === 'entrega' ? (
            <div className="flex justify-between text-slate-500">
              <span>Entrega{p.freteGratisMotivo ? ` (grátis: ${p.freteGratisMotivo.replace('_', ' ')})` : ''}</span>
              <span>{brl(p.taxaEntrega)}</span>
            </div>
          ) : null}
          <div className="flex justify-between font-bold text-slate-900">
            <span>Total ({metodoTxt(p.pagamentoMetodo)})</span>
            <span>{brl(p.total)}</span>
          </div>
        </div>
      </div>

      {p.observacao ? (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">Obs: {p.observacao}</p>
      ) : null}
      {p.canceladoMotivo ? (
        <p className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
          Motivo do cancelamento: {p.canceladoMotivo}
        </p>
      ) : null}

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Andamento</p>
        {etapas.length > 0 ? (
          <ol className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {etapas.map((x) => (
              <li key={x.txt}>
                {x.txt} <span className="font-medium text-slate-900">{quando(x.em)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-1 text-xs text-slate-600">
            Pedido feito {quando(p.criadoEm)}
            {p.pagoEm ? ` · pago ${quando(p.pagoEm)}` : ''}
          </p>
        )}
      </div>

      {p.status === 'concluido' ? <ImprimirENota p={p} podeAtualizar={podeAtualizar} /> : null}
      {p.tipo === 'entrega' && podeAtualizar && p.status === 'concluido' ? <EntregadorProprio p={p} /> : null}
      {ehGerente && podeAtualizar && p.status === 'concluido' ? <CancelarConcluido p={p} onCancelado={onCancelado} /> : null}
    </div>
  );
}

function CardPedido({
  p,
  podeAtualizar,
  onAcao,
}: {
  p: Pedido;
  podeAtualizar: boolean;
  onAcao: (id: string, tipo: string, motivo?: string) => void;
}) {
  const info = STATUS_INFO[p.status] ?? { txt: p.status, cls: 'bg-slate-100 text-slate-600' };
  const proximas: Array<{ acao: string; label: string }> = [];
  if (p.status === 'pago') proximas.push({ acao: 'aceitar', label: 'Aceitar → cozinha' });
  if (p.status === 'em_preparo') proximas.push({ acao: 'pronto', label: 'Marcar pronto' });
  if (p.status === 'pronto') {
    if (p.tipo === 'entrega') proximas.push({ acao: 'saiu', label: 'Saiu pra entrega' });
    else proximas.push({ acao: 'concluir', label: 'Cliente retirou' });
  }
  if (p.status === 'saiu_entrega' || p.status === 'chegou') proximas.push({ acao: 'concluir', label: 'Entregue' });

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold text-slate-900">
            #{p.numero} · {p.clienteNome}
          </p>
          <p className="text-xs text-slate-500">
            {p.tipo === 'entrega' ? '🛵 Entrega' : '🏖️ Retirada'} ·{' '}
            {p.asap ? `o quanto antes (${hhmm(p.pagoEm ?? p.criadoEm)})` : `${fmtData(p.agendadoData)} às ${p.agendadoHora}`}
            {p.distanciaKm ? ` · ${Number(p.distanciaKm).toFixed(1).replace('.', ',')} km` : ''}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${info.cls}`}>
          {info.txt}
        </span>
      </header>

      <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-sm">
        {p.itens.map((i, idx) => (
          <li key={idx} className="flex justify-between">
            <span className="text-slate-700">
              <span className="font-semibold">{i.qtd}×</span> {i.nome}
              {i.complementos?.length ? (
                <span className="block text-xs text-sky-700">
                  ↳ {i.complementos.map((c) => c.nome).join(', ')}
                </span>
              ) : null}
              {i.obs ? <span className="block text-xs text-amber-700">↳ {i.obs}</span> : null}
            </span>
            <span className="text-slate-500">{brl(i.total)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-2 border-t border-slate-100 pt-2 text-sm">
        <div className="flex justify-between text-slate-500">
          <span>Subtotal</span>
          <span>{brl(p.subtotal)}</span>
        </div>
        {Number(p.desconto) > 0 ? (
          <div className="flex justify-between text-emerald-700">
            <span>Cupom {p.cupomCodigo}</span>
            <span>− {brl(p.desconto)}</span>
          </div>
        ) : null}
        {p.tipo === 'entrega' ? (
          <div className="flex justify-between text-slate-500">
            <span>Entrega{p.freteGratisMotivo ? ' (grátis)' : ''}</span>
            <span>{brl(p.taxaEntrega)}</span>
          </div>
        ) : null}
        <div className="flex justify-between font-bold text-slate-900">
          <span>Total ({metodoTxt(p.pagamentoMetodo)})</span>
          <span>{brl(p.total)}</span>
        </div>
      </div>

      {p.tipo === 'entrega' && p.endereco ? (
        <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
          📍 {p.endereco.rua}, {p.endereco.numero}
          {p.endereco.complemento ? ` — ${p.endereco.complemento}` : ''} · {p.endereco.bairro}
          {p.endereco.referencia ? ` · ref: ${p.endereco.referencia}` : ''}
        </p>
      ) : null}
      {p.observacao ? (
        <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          Obs: {p.observacao}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {podeAtualizar
          ? proximas.map((a) => (
              <button
                key={a.acao}
                onClick={() => onAcao(p.id, a.acao)}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                {a.label}
              </button>
            ))
          : null}
        <a
          href={`https://wa.me/${p.clienteTelefone}?text=${encodeURIComponent(`Oi ${p.clienteNome.split(' ')[0]}! Sobre seu pedido #${p.numero}:`)}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          WhatsApp
        </a>
        {podeAtualizar ? (
          <button
            onClick={() => {
              const motivo = window.prompt(
                'Cancelar o pedido. Motivo (o cliente recebe no WhatsApp):',
                'Item indisponível',
              );
              if (motivo === null) return;
              onAcao(p.id, 'cancelar', motivo);
            }}
            className="ml-auto rounded-md border border-rose-200 bg-white px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
          >
            Cancelar
          </button>
        ) : null}
      </div>
      {p.tipo === 'entrega' && podeAtualizar && ABERTO_ENTREGADOR.includes(p.status) ? (
        <EntregadorIfood p={p} />
      ) : null}
      {p.tipo === 'entrega' && podeAtualizar && (ABERTO_ENTREGADOR.includes(p.status) || p.status === 'concluido') ? (
        <EntregadorProprio p={p} />
      ) : null}
      {p.status !== 'pendente_pagamento' && p.status !== 'cancelado' ? (
        <ImprimirENota p={p} podeAtualizar={podeAtualizar} />
      ) : null}
    </article>
  );
}

/** Via do pedido (com endereço) e NFC-e do pedido — dono 22/11/2026. A nota
 *  sai sozinha no despacho (Pix/cartão pago no site) e vai pra impressora da
 *  loja; aqui dá pra abrir/imprimir de novo. Pagamento na entrega: a nota sai
 *  pelo caixa da loja (vira pedido no PDV). */
function ImprimirENota({ p, podeAtualizar }: { p: Pedido; podeAtualizar: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const naEntrega = p.pagamentoMetodo === 'na_entrega';
  // Situação da NFC-e (dono 22/11/2026: todo delivery sai com nota) — mostra
  // no card se a nota do despacho saiu; se não saiu, o aviso fica vermelho.
  const [sit, setSit] = useState<{
    situacao: string;
    nfceId?: string;
    numero?: number;
    motivo?: string | null;
  } | null>(null);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    if (naEntrega) return;
    let vivo = true;
    fetch(`/api/delivery-admin/pedido/${p.id}/nota`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo && j) setSit(j);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [p.id, p.status, naEntrega, versao]);
  const jaSaiu = ['saiu_entrega', 'chegou', 'concluido'].includes(p.status);

  async function nota(imprimir: boolean) {
    setOcupado(true);
    setMsg(imprimir ? 'mandando pra impressora da loja…' : 'emitindo a nota…');
    // abre a aba já no clique (o navegador bloqueia popup depois do await)
    const aba = imprimir ? null : window.open('about:blank', '_blank');
    try {
      const r = await fetch(`/api/delivery-admin/pedido/${p.id}/nota`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imprimir }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        aba?.close();
        setMsg(`⚠ ${j.error ?? `erro ${r.status}`}`);
        return;
      }
      if (aba) aba.location.href = `/fiscal/nfce/${j.nfceId}/danfe`;
      setVersao((v) => v + 1);
      setMsg(
        imprimir
          ? `✓ NFC-e nº ${j.numero} na fila da impressora da loja`
          : `✓ NFC-e nº ${j.numero}${j.jaExistia ? ' (já emitida)' : ' emitida'}`,
      );
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 text-sm">
      <a
        href={`/delivery-admin/pedido/${p.id}/imprimir?auto=1`}
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
      >
        🖨 Imprimir pedido
      </a>
      {podeAtualizar && !naEntrega ? (
        <>
          <button
            disabled={ocupado}
            onClick={() => nota(false)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
          >
            🧾 Nota fiscal
          </button>
          <button
            disabled={ocupado}
            onClick={() => nota(true)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
          >
            Imprimir nota na loja
          </button>
        </>
      ) : null}
      {naEntrega ? (
        <span className="text-xs text-slate-500">Nota: sai pelo caixa da loja (pagamento na entrega)</span>
      ) : null}
      {!naEntrega && sit?.situacao === 'autorizada' ? (
        <a
          href={`/fiscal/nfce/${sit.nfceId}/danfe`}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
        >
          🧾 NFC-e nº {sit.numero} emitida
        </a>
      ) : null}
      {!naEntrega && sit?.situacao === 'emitindo' ? (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          🧾 emitindo a nota…
        </span>
      ) : null}
      {!naEntrega && jaSaiu && (sit?.situacao === 'falhou' || sit?.situacao === 'sem_nota') ? (
        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
          ⚠ Saiu SEM nota{sit.motivo ? ` (${sit.motivo})` : ''} — toque em 🧾 Nota fiscal
        </span>
      ) : null}
      {msg ? <span className="text-xs text-slate-600">{msg}</span> : null}
    </div>
  );
}

const ABERTO_ENTREGADOR = ['pago', 'em_preparo', 'pronto', 'saiu_entrega', 'chegou'];

interface EntregaIfood {
  id: string;
  status: string;
  trackingUrl: string | null;
  valor: string | null;
  erro: string | null;
  criadoEm: string;
  trocaEndereco?: { pedidoEm?: string; metadata?: unknown; enderecoAtual?: unknown } | null;
  trocaEnderecoStatus?: string | null;
  coletaConferidaEm?: string | null;
}

/** Endereço vindo do iFood (metadata do evento DAR ou deliveryAddress) em uma linha. */
function textoEnderecoIfood(x: unknown): string | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const dentro = (o.deliveryAddress ?? o.address ?? o.newAddress ?? o.newDeliveryAddress) as unknown;
  if (dentro && typeof dentro === 'object') return textoEnderecoIfood(dentro);
  if (typeof o.formattedAddress === 'string' && o.formattedAddress) return o.formattedAddress;
  const partes = [
    [o.streetName, o.streetNumber].filter(Boolean).join(', '),
    o.complement,
    o.neighborhood,
    o.city,
  ].filter((v) => typeof v === 'string' && v);
  if (partes.length) return partes.join(' · ');
  const j = JSON.stringify(o);
  return j === '{}' ? null : j.slice(0, 300);
}

interface Cotacao {
  quoteId: string;
  valor: number;
  minMin: number | null;
  maxMin: number | null;
  distanciaM: number | null;
}

const ENTREGA_TXT: Record<string, string> = {
  SOLICITADO: 'Chamado — aguardando o iFood confirmar',
  CONFIRMADO: 'Chamado — iFood procurando entregador',
  CODIGO: 'Entregador pediu o código',
  A_CAMINHO: 'Entregador a caminho',
  ENTREGUE: 'Entregue pelo iFood',
  CANCELADO: 'Entregador cancelado',
  ERRO: 'Erro no iFood',
};
const ENTREGA_ATIVA = ['SOLICITADO', 'CONFIRMADO', 'CODIGO', 'A_CAMINHO'];

/** "🛵 Chamar entregador iFood": cota, mostra preço/tempo, chama e cancela.
 *  Fica abaixo dos botões de sempre — não troca nenhum deles. */
function EntregadorIfood({ p }: { p: Pedido }) {
  const [entrega, setEntrega] = useState<EntregaIfood | null>(null);
  const [cot, setCot] = useState<Cotacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [preparo, setPreparo] = useState(p.status === 'pronto' ? 0 : 15);
  const [metodo, setMetodo] = useState('');
  const [troco, setTroco] = useState('');
  const [codigoColeta, setCodigoColeta] = useState<string | null>(null);
  const [codigoFalado, setCodigoFalado] = useState('');
  const url = `/api/delivery-admin/pedido/${p.id}/entregador-ifood`;
  const naEntrega = p.pagamentoMetodo === 'na_entrega';

  async function ler() {
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setEntrega(j.entrega ?? null);
      setCodigoColeta(j.codigoColeta ?? null);
    }
  }
  useEffect(() => {
    ler();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);
  const ativa = !!entrega && ENTREGA_ATIVA.includes(entrega.status);
  useEffect(() => {
    if (!ativa) return;
    const t = setInterval(ler, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativa]);

  async function post(corpo: Record<string, unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(j.error ?? `erro ${r.status}`);
        return null;
      }
      return j;
    } finally {
      setOcupado(false);
    }
  }

  async function cotar() {
    const j = await post({ acao: 'cotar' });
    if (j?.cotacao) setCot(j.cotacao);
  }
  async function chamar() {
    if (naEntrega && !metodo) {
      setErro('pedido pago na entrega: escolha crédito, débito ou dinheiro');
      return;
    }
    const j = await post({
      acao: 'chamar',
      quoteId: cot?.quoteId,
      valorCotado: cot?.valor,
      preparoMin: preparo,
      metodoNaEntrega: metodo || undefined,
      trocoPara: troco ? Number(troco.replace(',', '.')) : undefined,
    });
    if (j?.entrega) {
      setEntrega(j.entrega);
      setCot(null);
    }
  }
  async function cancelar() {
    const j = await post({ acao: 'motivos' });
    if (!j) return;
    const motivos: Array<{ codigo: number; descricao: string }> = j.motivos ?? [];
    if (!motivos.length) {
      setErro('o iFood não aceita mais cancelar este entregador');
      return;
    }
    const lista = motivos.map((m, i) => `${i + 1}. ${m.descricao}`).join('\n');
    const esc = window.prompt(`Cancelar o entregador do iFood. Número do motivo:\n${lista}`, '1');
    if (esc === null) return;
    const m = motivos[Number(esc) - 1];
    if (!m) {
      setErro('motivo inválido');
      return;
    }
    const ok = await post({ acao: 'cancelar', codigo: m.codigo, motivo: m.descricao });
    if (ok) await ler();
  }
  async function responderEndereco(aceitar: boolean) {
    const pergunta = aceitar
      ? 'Aceitar o endereço novo? O entregador do iFood vai pro endereço que o cliente mudou.'
      : 'Recusar a troca? O entregador continua indo pro endereço original.';
    if (!window.confirm(pergunta)) return;
    const j = await post({ acao: aceitar ? 'endereco_aceitar' : 'endereco_recusar' });
    if (j?.entrega) setEntrega(j.entrega);
  }
  async function conferirColeta() {
    const j = await post({ acao: 'coleta_conferir', codigo: codigoFalado });
    if (j?.entrega) {
      setEntrega(j.entrega);
      setCodigoFalado('');
    }
  }
  const troca = entrega?.trocaEndereco ?? null;
  const enderecoNovo = troca ? (textoEnderecoIfood(troca.metadata) ?? textoEnderecoIfood(troca.enderecoAtual)) : null;

  return (
    <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50/40 p-3 text-sm">
      {entrega && entrega.status !== 'CANCELADO' && entrega.status !== 'ERRO' ? (
        <div className="space-y-1.5">
          <p className="font-semibold text-rose-800">
            🛵 iFood: {ENTREGA_TXT[entrega.status] ?? entrega.status}
            {entrega.valor ? ` · ${brl(entrega.valor)}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {entrega.trackingUrl ? (
              <a
                href={entrega.trackingUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-rose-700 hover:bg-rose-50"
              >
                Acompanhar
              </a>
            ) : null}
            {entrega.trackingUrl ? (
              <a
                href={`https://wa.me/${p.clienteTelefone}?text=${encodeURIComponent(`Seu pedido #${p.numero} vai com entregador do iFood. Acompanhe: ${entrega.trackingUrl} — o código de entrega são os 4 últimos dígitos do seu telefone.`)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-rose-700 hover:bg-rose-50"
              >
                Mandar link pro cliente
              </a>
            ) : null}
            {ENTREGA_ATIVA.includes(entrega.status) ? (
              <button
                disabled={ocupado}
                onClick={cancelar}
                className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
              >
                Cancelar entregador
              </button>
            ) : null}
          </div>
          {entrega.trocaEnderecoStatus === 'PENDENTE' ? (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
              <p className="font-semibold text-amber-900">📍 Cliente mudou o endereço de entrega</p>
              <p className="mt-0.5 text-xs text-amber-900">{enderecoNovo ?? 'o iFood não mandou o endereço novo — confira no app do cliente'}</p>
              <div className="mt-2 flex gap-2">
                <button
                  disabled={ocupado}
                  onClick={() => responderEndereco(true)}
                  className="rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Aceitar endereço novo
                </button>
                <button
                  disabled={ocupado}
                  onClick={() => responderEndereco(false)}
                  className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  Recusar
                </button>
              </div>
            </div>
          ) : entrega.trocaEnderecoStatus === 'ACEITA' || entrega.trocaEnderecoStatus === 'RECUSADA' ? (
            <p className="text-xs text-slate-600">
              📍 Troca de endereço {entrega.trocaEnderecoStatus === 'ACEITA' ? 'aceita' : 'recusada'}
              {enderecoNovo && entrega.trocaEnderecoStatus === 'ACEITA' ? `: ${enderecoNovo}` : ''}
            </p>
          ) : null}
          {ENTREGA_ATIVA.includes(entrega.status) ? (
            entrega.coletaConferidaEm ? (
              <p className="text-xs font-medium text-emerald-700">✓ Código de coleta conferido — pode entregar o pedido ao entregador</p>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-700">
                {codigoColeta ? (
                  <span>
                    Código de coleta: <b className="font-mono text-sm tracking-widest text-rose-800">{codigoColeta}</b>
                  </span>
                ) : (
                  <span className="text-slate-500">Código de coleta: o iFood ainda não mandou</span>
                )}
                <input
                  value={codigoFalado}
                  onChange={(e) => setCodigoFalado(e.target.value)}
                  placeholder="código que o entregador falou"
                  className="w-48 rounded border border-slate-300 px-1.5 py-1"
                />
                <button
                  disabled={ocupado || !codigoFalado.trim()}
                  onClick={conferirColeta}
                  className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  Conferir
                </button>
              </div>
            )
          ) : null}
        </div>
      ) : cot ? (
        <div className="space-y-2">
          <p className="font-semibold text-rose-800">
            🛵 Corrida iFood: {brl(cot.valor)}
            {cot.minMin != null ? ` · ${cot.minMin}–${cot.maxMin ?? cot.minMin} min` : ''}
            {cot.distanciaM != null ? ` · ${(cot.distanciaM / 1000).toFixed(1).replace('.', ',')} km` : ''}
          </p>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Fica pronto em
            <select
              value={preparo}
              onChange={(e) => setPreparo(Number(e.target.value))}
              className="rounded border border-slate-300 px-1.5 py-1"
            >
              {[0, 5, 10, 15, 20, 30, 45].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? 'já está pronto' : `${m} min`}
                </option>
              ))}
            </select>
          </label>
          {naEntrega ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              Entregador cobra no
              <select
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
                className="rounded border border-slate-300 px-1.5 py-1"
              >
                <option value="">escolha…</option>
                <option value="CREDIT">crédito</option>
                <option value="DEBIT">débito</option>
                <option value="CASH">dinheiro</option>
              </select>
              {metodo === 'CASH' ? (
                <input
                  value={troco}
                  onChange={(e) => setTroco(e.target.value)}
                  placeholder="troco pra (R$)"
                  className="w-28 rounded border border-slate-300 px-1.5 py-1"
                />
              ) : null}
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              disabled={ocupado}
              onClick={chamar}
              className="rounded-md bg-rose-600 px-3 py-1.5 font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {ocupado ? 'Chamando…' : 'Confirmar e chamar'}
            </button>
            <button
              disabled={ocupado}
              onClick={() => setCot(null)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-600"
            >
              Voltar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={ocupado}
            onClick={cotar}
            className="rounded-md bg-rose-600 px-3 py-1.5 font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {ocupado ? 'Consultando o iFood…' : '🛵 Chamar entregador iFood'}
          </button>
          {entrega?.status === 'CANCELADO' ? (
            <span className="text-xs text-slate-500">o anterior foi cancelado</span>
          ) : null}
        </div>
      )}
      {erro ? <p className="mt-2 text-xs text-rose-700">⚠ {erro}</p> : null}
    </div>
  );
}

interface DespachoBoy {
  id: string;
  link: string;
  valor: number;
  codigoCliente: string;
  tentativas: number;
  bloqueado: boolean;
  entregueEm: string | null;
  pixStatus: string | null;
  pixErro: string | null;
  boy: { telefone: string; nome: string | null; pixChave: string | null; cadastroCompleto: boolean };
}

const PIX_BOY_LABEL: Record<string, string> = {
  PAGO: '✅ Pix pago',
  ENVIANDO: '⏳ Pix em processamento',
  APROVACAO: '⏳ Pix aguardando aprovação no Inter',
  AGENDADO: '⏳ Pix agendado',
  PENDENTE: '⚠️ Banco não respondeu — conferir no Inter',
  ERRO: '❌ Pix não saiu',
};

/** "🛵 Despachar com boy" (dono 22/11/2026): boy nosso ou de terceiro recebe o
 *  link no WhatsApp; o cliente recebe o código; com o código, o Pix do frete
 *  cheio cai na chave do boy. Fica ao lado do iFood — não troca nada. */
function EntregadorProprio({ p }: { p: Pedido }) {
  const [d, setD] = useState<DespachoBoy | null>(null);
  const [previsto, setPrevisto] = useState<number | null>(null);
  const [aberto, setAberto] = useState(false);
  const [tel, setTel] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; waBoy?: string; waCliente?: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const url = `/api/delivery-admin/pedido/${p.id}/despacho`;

  async function ler() {
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setD(j.despacho ?? null);
      if (j.valorPrevisto != null) setPrevisto(j.valorPrevisto);
    }
  }
  useEffect(() => {
    ler();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, p.status]);
  const naRua = !!d && !d.entregueEm;
  const pixAberto = !!d && !!d.entregueEm && d.pixStatus !== 'PAGO';
  useEffect(() => {
    if (!naRua && !pixAberto) return;
    const t = setInterval(ler, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naRua, pixAberto]);

  async function post(corpo: Record<string, unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(j.error ?? `erro ${r.status}`);
        return null;
      }
      return j;
    } finally {
      setOcupado(false);
    }
  }

  async function despachar() {
    const j = await post({ acao: 'despachar', telefone: tel });
    if (!j) return;
    setAberto(false);
    setAviso({
      texto: `${j.boyNovo ? 'Boy novo: ele faz o cadastro pelo link. ' : ''}${j.enviadoBoy ? 'Link enviado pro boy' : 'WhatsApp do boy não foi — mande pelo botão'} · ${j.enviadoCliente ? 'código enviado pro cliente' : 'código do cliente não foi — mande pelo botão'}.`,
      waBoy: j.enviadoBoy ? undefined : j.waBoy,
      waCliente: j.enviadoCliente ? undefined : j.waCliente,
    });
    await ler();
  }
  async function novoCodigo() {
    if (!window.confirm('Gerar um código novo e mandar pro cliente? O código antigo deixa de valer.')) return;
    const j = await post({ acao: 'novo_codigo' });
    if (!j) return;
    setAviso({
      texto: j.enviado ? 'Código novo enviado pro cliente.' : 'Código novo gerado — o WhatsApp não foi, mande pelo botão.',
      waCliente: j.enviado ? undefined : j.waCliente,
    });
    await ler();
  }

  if (!d && p.status === 'concluido') return null;
  const valor = d?.valor ?? previsto;

  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm">
      {d ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-emerald-900">
              🛵 Boy: {d.boy.nome ?? `(cadastro pendente) …${d.boy.telefone.slice(-4)}`}
            </span>
            <span className="text-emerald-800">{valor != null ? `R$ ${valor.toFixed(2).replace('.', ',')}` : ''}</span>
            {d.entregueEm ? (
              <span className="font-semibold">{d.pixStatus ? PIX_BOY_LABEL[d.pixStatus] ?? d.pixStatus : 'Entregue'}</span>
            ) : (
              <span className="rounded bg-white px-2 py-0.5 font-mono text-xs">código cliente {d.codigoCliente}</span>
            )}
          </div>
          {d.pixErro && d.pixStatus !== 'PAGO' ? <p className="text-xs text-rose-700">{d.pixErro}</p> : null}
          {d.bloqueado && !d.entregueEm ? (
            <p className="text-xs font-semibold text-rose-700">Boy errou o código {d.tentativas}x — gere um código novo.</p>
          ) : null}
          {!d.entregueEm ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={() => {
                  setTel(d.boy.telefone.replace(/^55/, ''));
                  setAberto(true);
                }}
                className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs"
              >
                Reenviar / trocar boy
              </button>
              <button onClick={novoCodigo} disabled={ocupado} className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs">
                Novo código pro cliente
              </button>
              <button
                onClick={() => navigator.clipboard?.writeText(d.link)}
                className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs"
              >
                Copiar link do boy
              </button>
            </div>
          ) : null}
        </div>
      ) : !aberto ? (
        <button
          onClick={() => setAberto(true)}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          🛵 Despachar com boy{valor != null ? ` (R$ ${valor.toFixed(2).replace('.', ',')})` : ''}
        </button>
      ) : null}

      {aberto ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={tel}
            onChange={(e) => setTel(e.target.value)}
            inputMode="tel"
            placeholder="WhatsApp do boy (DDD + número)"
            className="min-w-[200px] flex-1 rounded-md border border-slate-300 px-2 py-2"
          />
          <button
            onClick={despachar}
            disabled={ocupado || tel.replace(/\D/g, '').length < 10}
            className="rounded-md bg-emerald-600 px-3 py-2 font-semibold text-white disabled:opacity-50"
          >
            {ocupado ? 'Enviando…' : 'Mandar link'}
          </button>
          <button onClick={() => setAberto(false)} className="text-xs text-slate-500">
            cancelar
          </button>
        </div>
      ) : null}

      {aviso ? (
        <div className="mt-2 text-xs text-emerald-900">
          {aviso.texto}{' '}
          {aviso.waBoy ? (
            <a className="font-semibold underline" href={aviso.waBoy} target="_blank" rel="noreferrer">
              WhatsApp do boy
            </a>
          ) : null}{' '}
          {aviso.waCliente ? (
            <a className="font-semibold underline" href={aviso.waCliente} target="_blank" rel="noreferrer">
              WhatsApp do cliente
            </a>
          ) : null}
        </div>
      ) : null}
      {erro ? <p className="mt-1 text-xs font-semibold text-rose-700">{erro}</p> : null}
    </div>
  );
}
