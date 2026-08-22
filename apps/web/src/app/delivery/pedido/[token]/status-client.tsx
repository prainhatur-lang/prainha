'use client';

// Acompanhamento do pedido de delivery. Pendente: mostra o pagamento (QR do
// Pix com polling na Cielo, ou cartão com 3DS — o mesmo CreditCardForm da
// reserva, apontado pros endpoints do delivery). Pago em diante: linha do
// tempo do preparo, com polling mais espaçado.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CreditCardForm } from '@/app/reservar/[token]/credit-card-form';

interface PedidoResp {
  numero: number;
  status: string;
  tipo: 'entrega' | 'retirada';
  clienteNome: string;
  agendadoData: string;
  agendadoHora: string | null;
  asap: boolean;
  endereco: {
    rua?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    referencia?: string;
  } | null;
  subtotal: string;
  taxaEntrega: string;
  desconto: string;
  total: string;
  freteGratisLabel: string | null;
  cupomCodigo: string | null;
  observacao: string | null;
  canceladoMotivo: string | null;
  pagamento: {
    metodo: 'pix' | 'cartao' | null;
    status: string | null;
    qrCodeString: string | null;
    qrCodeBase64: string | null;
  };
  itens: Array<{
    nome: string;
    qtd: number;
    precoUnit: string;
    total: string;
    obs: string | null;
    complementos: Array<{ nome: string; precoCentavos: number }> | null;
  }>;
  loja: {
    nome: string;
    slug: string | null;
    whatsapp: string | null;
    tempoPreparoMin: number | null;
    tempoPreparoMax: number | null;
    endereco: { rua?: string; numero?: string; bairro?: string; cidade?: string } | null;
  } | null;
}

const brl = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtData(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

const lbl = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--dlv-muted)]';

export function StatusClient({ token }: { token: string }) {
  const [pedido, setPedido] = useState<PedidoResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [mostrarCartao, setMostrarCartao] = useState(false);
  const [gerandoPix, setGerandoPix] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/delivery/pedido/${token}`, { cache: 'no-store' });
      if (!r.ok) {
        if (r.status === 404) setErro('Pedido não encontrado.');
        return;
      }
      const d = (await r.json()) as PedidoResp;
      setPedido(d);
      setErro(null);
    } catch {
      /* rede oscilou — próximo poll resolve */
    }
  }, [token]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // polling: 5s aguardando pagamento, 12s durante o preparo, para no fim
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!pedido) {
      timerRef.current = setInterval(() => void carregar(), 5000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
    if (pedido.status === 'concluido' || pedido.status === 'cancelado') return;
    const intervalo = pedido.status === 'pendente_pagamento' ? 5000 : 12000;
    timerRef.current = setInterval(() => void carregar(), intervalo);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [pedido, carregar]);

  async function copiarPix() {
    if (!pedido?.pagamento.qrCodeString) return;
    try {
      await navigator.clipboard.writeText(pedido.pagamento.qrCodeString);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      /* clipboard bloqueado — o cliente seleciona manualmente */
    }
  }

  async function gerarPix() {
    setGerandoPix(true);
    setErro(null);
    try {
      const r = await fetch(`/api/delivery/pedido/${token}/pix`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErro(d.error ?? 'Não consegui gerar o Pix agora.');
      setMostrarCartao(false);
      await carregar();
    } catch {
      setErro('Falha de conexão — tente de novo.');
    } finally {
      setGerandoPix(false);
    }
  }

  if (erro && !pedido) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-5">
        <p className="text-sm text-[var(--dlv-muted)]">{erro}</p>
      </main>
    );
  }
  if (!pedido) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-5">
        <p className="text-sm text-[var(--dlv-muted)]">Carregando seu pedido…</p>
      </main>
    );
  }

  const pendente = pedido.status === 'pendente_pagamento';
  const cancelado = pedido.status === 'cancelado';
  const etapas =
    pedido.tipo === 'entrega'
      ? [
          { id: 'pago', label: 'Pedido recebido' },
          { id: 'em_preparo', label: 'Na cozinha' },
          { id: 'pronto', label: 'Pronto' },
          { id: 'saiu_entrega', label: 'Saiu pra entrega' },
          { id: 'concluido', label: 'Entregue' },
        ]
      : [
          { id: 'pago', label: 'Pedido recebido' },
          { id: 'em_preparo', label: 'Na cozinha' },
          { id: 'pronto', label: 'Pronto pra retirada' },
          { id: 'concluido', label: 'Retirado' },
        ];
  const idxAtual = etapas.findIndex((e) => e.id === pedido.status);
  const totalCents = Math.round(Number(pedido.total) * 100);
  const aguardandoPixComQr =
    pendente && pedido.pagamento.metodo === 'pix' && !!pedido.pagamento.qrCodeString;

  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-16 pt-6 lg:max-w-2xl lg:pt-10">
      <div className="text-center">
        <span
          className="text-2xl tracking-tight text-[var(--dlv-strong)]"
          style={{ fontFamily: 'var(--dlv-display)' }}
        >
          {pedido.loja?.nome ?? 'Prainha'}
          <span className="text-[var(--dlv-brand-dot)]">.</span>
        </span>
        <p className="mt-1 text-sm text-[var(--dlv-muted)]">
          Pedido <span className="font-bold text-[var(--dlv-ink)]">#{pedido.numero}</span> ·{' '}
          {pedido.asap
            ? 'o quanto antes'
            : `${fmtData(pedido.agendadoData)} às ${pedido.agendadoHora}`}
        </p>
      </div>

      {/* ---- pagamento pendente ---- */}
      {pendente ? (
        <section className="mt-5 rounded-2xl border border-[var(--dlv-card-line)] bg-[var(--dlv-card)] p-5">
          <h2 className="text-base font-bold text-[var(--dlv-ink)]">
            Falta só o pagamento — {brl(pedido.total)}
          </h2>
          <p className="mt-1 text-xs text-[var(--dlv-muted)]">
            Seu pedido segue pra cozinha assim que o pagamento for aprovado. Você tem até 40
            minutos antes de ele expirar.
          </p>

          {erro ? <p className="mt-2 text-xs font-semibold text-rose-700">{erro}</p> : null}

          {!mostrarCartao ? (
            aguardandoPixComQr ? (
              <div className="mt-4 text-center">
                {pedido.pagamento.qrCodeBase64 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`data:image/png;base64,${pedido.pagamento.qrCodeBase64}`}
                    alt="QR code Pix"
                    className="mx-auto h-52 w-52 rounded-md border border-[var(--dlv-card-line)]"
                  />
                ) : null}
                <p className="mt-2 text-xs text-[var(--dlv-muted)]">
                  Abra o app do seu banco, escolha Pix e escaneie — ou copie o código:
                </p>
                <button
                  onClick={() => void copiarPix()}
                  className="mt-2 w-full rounded-full bg-[var(--dlv-escuro)] px-4 py-3 text-sm font-semibold text-[var(--dlv-accent-ink)]"
                >
                  {copiado ? '✓ Código copiado!' : 'Copiar código Pix'}
                </button>
                <p className="mt-3 text-xs text-[var(--dlv-muted)]">
                  Pagou? A confirmação aparece aqui sozinha em segundos.
                </p>
              </div>
            ) : (
              <button
                onClick={() => void gerarPix()}
                disabled={gerandoPix}
                className="mt-4 w-full rounded-full bg-[var(--dlv-escuro)] px-4 py-3 text-sm font-semibold text-[var(--dlv-accent-ink)] disabled:opacity-50"
              >
                {gerandoPix ? 'Gerando Pix…' : 'Gerar QR code Pix'}
              </button>
            )
          ) : null}

          {mostrarCartao ? (
            <div className="mt-4">
              <CreditCardForm
                token={token}
                reservaId={token}
                totalCents={totalCents}
                onPago={() => {
                  setMostrarCartao(false);
                  void carregar();
                }}
                endpointPagamento={`/api/delivery/pedido/${token}/pagamento-cartao`}
                endpointMpiToken={`/api/delivery/pedido/${token}/mpi-token`}
              />
            </div>
          ) : null}

          <button
            onClick={() => {
              if (mostrarCartao) void gerarPix();
              else setMostrarCartao(true);
            }}
            className="mt-3 w-full text-center text-xs font-semibold text-[var(--dlv-strong)] underline"
          >
            {mostrarCartao ? 'Prefiro pagar com Pix' : 'Prefiro pagar com cartão'}
          </button>
        </section>
      ) : null}

      {/* ---- cancelado ---- */}
      {cancelado ? (
        <section className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center">
          <p className="text-base font-bold text-rose-700">Pedido cancelado</p>
          {pedido.canceladoMotivo ? (
            <p className="mt-1 text-sm text-rose-700/80">{pedido.canceladoMotivo}</p>
          ) : null}
          {pedido.pagamento.status === 'reembolsado' ? (
            <p className="mt-2 text-xs text-rose-700/80">
              O valor pago foi estornado — pode levar alguns dias pra aparecer na fatura.
            </p>
          ) : null}
          {pedido.loja?.slug ? (
            <a
              href={`/delivery/${pedido.loja.slug}`}
              className="mt-3 inline-block rounded-full bg-[var(--dlv-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--dlv-accent-ink)]"
            >
              Fazer novo pedido
            </a>
          ) : null}
        </section>
      ) : null}

      {/* ---- linha do tempo ---- */}
      {!pendente && !cancelado ? (
        <section className="mt-5 rounded-2xl border border-[var(--dlv-card-line)] bg-[var(--dlv-card)] p-5">
          <ol className="space-y-3">
            {etapas.map((e, idx) => {
              const feito = idx <= idxAtual;
              const atual = idx === idxAtual;
              return (
                <li key={e.id} className="flex items-center gap-3">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      feito ? 'bg-emerald-600 text-white' : 'bg-[var(--dlv-surface)] text-[var(--dlv-placeholder)]'
                    }`}
                  >
                    {feito ? '✓' : idx + 1}
                  </span>
                  <span
                    className={`text-sm ${
                      atual
                        ? 'font-bold text-[var(--dlv-ink)]'
                        : feito
                          ? 'text-[var(--dlv-text)]'
                          : 'text-[var(--dlv-placeholder)]'
                    }`}
                  >
                    {e.label}
                    {atual && pedido.status === 'pago' ? ' — obrigado! 🌅' : ''}
                  </span>
                </li>
              );
            })}
          </ol>
          {pedido.status === 'pago' &&
          pedido.loja?.tempoPreparoMin != null &&
          pedido.loja?.tempoPreparoMax != null &&
          pedido.asap ? (
            <p className="mt-3 text-xs text-[var(--dlv-muted)]">
              Tempo estimado: {pedido.loja.tempoPreparoMin}–{pedido.loja.tempoPreparoMax} min.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ---- resumo ---- */}
      <section className="mt-3 rounded-2xl border border-[var(--dlv-card-line)] bg-[var(--dlv-card)] p-5">
        <p className={lbl}>Resumo</p>
        <ul className="mt-2 divide-y divide-[var(--dlv-surface)]">
          {pedido.itens.map((i, idx) => (
            <li key={idx} className="flex justify-between py-2 text-sm">
              <span className="text-[var(--dlv-text)]">
                {i.qtd}× {i.nome}
                {i.complementos?.length ? (
                  <span className="block text-xs text-[var(--dlv-muted)]">
                    + {i.complementos.map((c) => c.nome).join(', ')}
                  </span>
                ) : null}
                {i.obs ? <span className="block text-xs text-[var(--dlv-muted)]">{i.obs}</span> : null}
              </span>
              <span className="text-[var(--dlv-ink)]">{brl(i.total)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 space-y-1 border-t border-[var(--dlv-surface)] pt-2 text-sm">
          <div className="flex justify-between text-[var(--dlv-text)]">
            <span>Subtotal</span>
            <span>{brl(pedido.subtotal)}</span>
          </div>
          {Number(pedido.desconto) > 0 ? (
            <div className="flex justify-between text-emerald-700">
              <span>Cupom {pedido.cupomCodigo}</span>
              <span>− {brl(pedido.desconto)}</span>
            </div>
          ) : null}
          {pedido.tipo === 'entrega' ? (
            <div className="flex justify-between text-[var(--dlv-text)]">
              <span>Entrega{pedido.freteGratisLabel ? ' (grátis)' : ''}</span>
              <span>{Number(pedido.taxaEntrega) === 0 ? 'R$ 0,00 🎉' : brl(pedido.taxaEntrega)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-bold text-[var(--dlv-ink)]">
            <span>Total</span>
            <span>{brl(pedido.total)}</span>
          </div>
        </div>
        {pedido.freteGratisLabel ? (
          <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
            {pedido.freteGratisLabel}
          </p>
        ) : null}
      </section>

      {/* ---- endereço / retirada ---- */}
      <section className="mt-3 rounded-2xl border border-[var(--dlv-card-line)] bg-[var(--dlv-card)] p-5 text-sm">
        {pedido.tipo === 'entrega' && pedido.endereco ? (
          <>
            <p className={lbl}>Entregar em</p>
            <p className="mt-1 text-[var(--dlv-text)]">
              {pedido.endereco.rua}, {pedido.endereco.numero}
              {pedido.endereco.complemento ? ` — ${pedido.endereco.complemento}` : ''} ·{' '}
              {pedido.endereco.bairro}
            </p>
            {pedido.endereco.referencia ? (
              <p className="text-xs text-[var(--dlv-muted)]">Ref: {pedido.endereco.referencia}</p>
            ) : null}
          </>
        ) : (
          <>
            <p className={lbl}>Retirar em</p>
            <p className="mt-1 text-[var(--dlv-text)]">
              {pedido.loja?.endereco
                ? `${pedido.loja.endereco.rua ?? ''}${pedido.loja.endereco.numero ? `, ${pedido.loja.endereco.numero}` : ''} · ${pedido.loja.endereco.bairro ?? ''}`
                : 'No balcão da loja'}
            </p>
          </>
        )}
        {pedido.observacao ? (
          <p className="mt-2 text-xs text-[var(--dlv-muted)]">Obs: {pedido.observacao}</p>
        ) : null}
      </section>

      {pedido.loja?.whatsapp ? (
        <p className="pt-5 text-center text-xs text-[var(--dlv-muted)]">
          Precisa falar com a gente?{' '}
          <a
            href={`https://wa.me/${pedido.loja.whatsapp}?text=${encodeURIComponent(`Oi! Sobre o pedido #${pedido.numero}:`)}`}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-[var(--dlv-strong)] underline"
          >
            Chama no WhatsApp
          </a>
        </p>
      ) : null}
    </main>
  );
}
