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
  itens: ItemPedido[];
}

interface Props {
  pedidos: Pedido[];
  filiais: Array<{ id: string; nome: string }>;
  filialFiltro: string | null;
  podeAtualizar: boolean;
  podeConfigurar: boolean;
  lojas: Array<{ id: string; slug: string | null; ativo: boolean; pausado: boolean }>;
}

const STATUS_INFO: Record<string, { txt: string; cls: string }> = {
  pendente_pagamento: { txt: 'Aguardando pagamento', cls: 'bg-slate-100 text-slate-600' },
  pago: { txt: 'Novo — pago', cls: 'bg-emerald-100 text-emerald-700' },
  em_preparo: { txt: 'Na cozinha', cls: 'bg-amber-100 text-amber-800' },
  pronto: { txt: 'Pronto', cls: 'bg-sky-100 text-sky-700' },
  saiu_entrega: { txt: 'Saiu pra entrega', cls: 'bg-violet-100 text-violet-700' },
  concluido: { txt: 'Concluído', cls: 'bg-slate-100 text-slate-500' },
  cancelado: { txt: 'Cancelado', cls: 'bg-rose-100 text-rose-700' },
};

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
                  {p.pagamentoMetodo === 'pix' ? 'Pix' : 'cartão'}
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
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span className="text-slate-600">
                  #{p.numero} · {p.clienteNome} · {brl(p.total)}
                  {p.canceladoMotivo ? (
                    <span className="ml-1 text-xs text-rose-600">({p.canceladoMotivo})</span>
                  ) : null}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_INFO[p.status]?.cls ?? ''}`}
                >
                  {STATUS_INFO[p.status]?.txt ?? p.status}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
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
  if (p.status === 'saiu_entrega') proximas.push({ acao: 'concluir', label: 'Entregue' });

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
          <span>Total {p.pagamentoMetodo === 'pix' ? '(Pix)' : '(cartão)'}</span>
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
    </article>
  );
}
