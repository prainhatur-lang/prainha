'use client';

// Acompanhamento do pedido de delivery. Pendente: mostra o pagamento (QR do
// Pix com polling na Cielo, ou cartão com 3DS — o mesmo CreditCardForm da
// reserva, apontado pros endpoints do delivery). Pago em diante: linha do
// tempo do preparo, com polling mais espaçado.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CreditCardForm } from '@/app/reservar/[token]/credit-card-form';
import { TXT_DELIVERY, TXT_PEDIDO, type IdiomaDelivery } from '@/lib/delivery/idioma';

const CODIGO_ENTREGA_TXT: Record<string, { titulo: string; dica: string }> = {
  pt: { titulo: 'Seu código de entrega', dica: 'Passe pro entregador só quando receber o pedido.' },
  en: { titulo: 'Your delivery code', dica: 'Give it to the courier only when you receive your order.' },
  es: { titulo: 'Tu código de entrega', dica: 'Dáselo al repartidor solo cuando recibas tu pedido.' },
  fr: { titulo: 'Votre code de livraison', dica: 'Donnez-le au livreur seulement à la réception.' },
  it: { titulo: 'Il tuo codice di consegna', dica: 'Dallo al fattorino solo quando ricevi l’ordine.' },
};

// Cliente confirma que recebeu (dono 22/11/2026: "se ele clicar lá, receber,
// o boy recebe o Pix") — vale como o código digitado pelo entregador.
const RECEBI_TXT: Record<string, { botao: string; pergunta: string; sim: string; nao: string; ok: string }> = {
  pt: { botao: 'Já recebi meu pedido', pergunta: 'Confirma que o pedido chegou em suas mãos?', sim: 'Sim, recebi', nao: 'Ainda não', ok: 'Obrigado! Entrega confirmada.' },
  en: { botao: 'I got my order', pergunta: 'Confirm the order is in your hands?', sim: 'Yes, I got it', nao: 'Not yet', ok: 'Thank you! Delivery confirmed.' },
  es: { botao: 'Ya recibí mi pedido', pergunta: '¿Confirmas que el pedido llegó a tus manos?', sim: 'Sí, lo recibí', nao: 'Todavía no', ok: '¡Gracias! Entrega confirmada.' },
  fr: { botao: 'J’ai reçu ma commande', pergunta: 'Confirmez-vous avoir reçu la commande ?', sim: 'Oui, reçue', nao: 'Pas encore', ok: 'Merci ! Livraison confirmée.' },
  it: { botao: 'Ho ricevuto l’ordine', pergunta: 'Confermi che l’ordine è nelle tue mani?', sim: 'Sì, ricevuto', nao: 'Non ancora', ok: 'Grazie! Consegna confermata.' },
};

// Horários da linha do tempo e previsão (dono 22/11/2026: "seria interessante
// ter os horários ... tantos minutos que tá sendo preparado ... informar o
// cliente o tempo").
const TEMPO_TXT: Record<
  string,
  {
    ha: (min: number) => string;
    previsaoEntrega: string;
    previsaoRetirada: string;
    emInstantes: string;
    atraso: string;
  }
> = {
  pt: {
    ha: (m) => (m < 1 ? 'agora há pouco' : `há ${m} min`),
    previsaoEntrega: 'Previsão de chegada',
    previsaoRetirada: 'Previsão pra ficar pronto',
    emInstantes: 'chegando em instantes',
    atraso: 'Está levando um pouco mais que o normal — já já sai.',
  },
  en: {
    ha: (m) => (m < 1 ? 'just now' : `${m} min ago`),
    previsaoEntrega: 'Estimated arrival',
    previsaoRetirada: 'Estimated ready time',
    emInstantes: 'arriving any moment',
    atraso: 'Taking a little longer than usual — almost there.',
  },
  es: {
    ha: (m) => (m < 1 ? 'hace un momento' : `hace ${m} min`),
    previsaoEntrega: 'Llegada estimada',
    previsaoRetirada: 'Listo aproximadamente',
    emInstantes: 'llegando en instantes',
    atraso: 'Está tardando un poco más de lo normal — ya casi.',
  },
  fr: {
    ha: (m) => (m < 1 ? 'à l’instant' : `il y a ${m} min`),
    previsaoEntrega: 'Arrivée prévue',
    previsaoRetirada: 'Prêt vers',
    emInstantes: 'arrive d’un instant à l’autre',
    atraso: 'Un peu plus long que d’habitude — presque prêt.',
  },
  it: {
    ha: (m) => (m < 1 ? 'poco fa' : `${m} min fa`),
    previsaoEntrega: 'Arrivo previsto',
    previsaoRetirada: 'Pronto verso le',
    emInstantes: 'in arrivo a momenti',
    atraso: 'Ci vuole un po’ più del solito — quasi pronto.',
  },
};

const MIN = 60_000;

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Maceio',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface PedidoResp {
  numero: number;
  status: string;
  tipo: 'entrega' | 'retirada';
  clienteNome: string;
  clienteCpfMascarado?: string | null;
  clienteTelefone?: string | null;
  agendadoData: string;
  agendadoHora: string | null;
  asap: boolean;
  endereco: {
    rua?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    referencia?: string;
    cep?: string;
    cidade?: string;
    uf?: string;
  } | null;
  subtotal: string;
  taxaEntrega: string;
  desconto: string;
  total: string;
  freteGratisLabel: string | null;
  freteGratisMotivo?: string | null;
  cupomCodigo: string | null;
  observacao: string | null;
  canceladoMotivo: string | null;
  /** Código que o cliente passa pro entregador (só com o pedido na rua). */
  codigoEntrega?: string | null;
  /** Primeira vez em cada status (ISO). */
  statusEm?: Record<string, string>;
  /** Relógio do servidor no momento da resposta. */
  agora?: string;
  /** Minutos estimados de moto até o cliente. */
  deslocamentoMin?: number;
  pagamento: {
    metodo: 'pix' | 'cartao' | 'na_entrega' | null;
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

export function StatusClient({
  token,
  lang = 'pt',
  traducoes = {},
}: {
  token: string;
  /** Idioma da tela (?lang= do cardápio); sem ele, português. */
  lang?: IdiomaDelivery;
  /** Nome do prato/complemento em português → no idioma do cliente. */
  traducoes?: Record<string, string>;
}) {
  const t = TXT_PEDIDO[lang] ?? TXT_PEDIDO.pt;
  const tr = (s: string) => traducoes[s.trim()] ?? s;
  const [pedido, setPedido] = useState<PedidoResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [mostrarCartao, setMostrarCartao] = useState(false);
  const [gerandoPix, setGerandoPix] = useState(false);
  const [recebiPergunta, setRecebiPergunta] = useState(false);
  const [recebiEnviando, setRecebiEnviando] = useState(false);
  const [recebiMsg, setRecebiMsg] = useState<string | null>(null);
  const rt = RECEBI_TXT[lang] ?? RECEBI_TXT.pt;
  async function confirmarRecebi() {
    setRecebiEnviando(true);
    try {
      const r = await fetch(`/api/delivery/pedido/${token}/recebi`, { method: 'POST' });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setRecebiMsg(`⚠ ${j.error ?? `erro ${r.status}`}`);
        return;
      }
      setRecebiMsg(rt.ok);
      setRecebiPergunta(false);
      void carregar();
    } catch {
      setRecebiMsg('⚠ sem conexão, tente de novo');
    } finally {
      setRecebiEnviando(false);
    }
  }
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // diferença servidor − celular, pra contar minutos pelo relógio do servidor
  const [desvio, setDesvio] = useState(0);
  const [, setTique] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTique((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/delivery/pedido/${token}`, { cache: 'no-store' });
      if (!r.ok) {
        if (r.status === 404) setErro(t.naoEncontrado);
        return;
      }
      const d = (await r.json()) as PedidoResp;
      setPedido(d);
      if (d.agora) setDesvio(new Date(d.agora).getTime() - Date.now());
      setErro(null);
    } catch {
      /* rede oscilou — próximo poll resolve */
    }
  }, [token, t]);

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
      if (!r.ok) setErro(d.error ?? t.pixErro);
      setMostrarCartao(false);
      await carregar();
    } catch {
      setErro(t.falhaConexao);
    } finally {
      setGerandoPix(false);
    }
  }

  if (erro && !pedido) {
    return (
      <main
        className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-5"
        lang={lang !== 'pt' ? lang : undefined}
      >
        <p className="text-sm text-[var(--dlv-muted)]">{erro}</p>
      </main>
    );
  }
  if (!pedido) {
    return (
      <main
        className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-5"
        lang={lang !== 'pt' ? lang : undefined}
      >
        <p className="text-sm text-[var(--dlv-muted)]">{t.carregando}</p>
      </main>
    );
  }

  const pendente = pedido.status === 'pendente_pagamento';
  const cancelado = pedido.status === 'cancelado';
  const etapas =
    pedido.tipo === 'entrega'
      ? [
          { id: 'pago', label: t.recebido },
          { id: 'em_preparo', label: t.naCozinha },
          { id: 'pronto', label: t.pronto },
          { id: 'saiu_entrega', label: t.saiuEntrega },
          { id: 'chegou', label: t.naPorta },
          { id: 'concluido', label: t.entregue },
        ]
      : [
          { id: 'pago', label: t.recebido },
          { id: 'em_preparo', label: t.naCozinha },
          { id: 'pronto', label: t.prontoRetirada },
          { id: 'concluido', label: t.retirado },
        ];
  const idxAtual = etapas.findIndex((e) => e.id === pedido.status);
  const tt = TEMPO_TXT[lang] ?? TEMPO_TXT.pt;
  const agoraMs = Date.now() + desvio;
  const horaDe = (st: string): number | null => {
    const iso = pedido.statusEm?.[st];
    const ms = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(ms) ? ms : null;
  };
  // Previsão: só "o quanto antes" e com tempo de preparo configurado.
  // Preparo conta do pagamento; entrega soma o deslocamento. Se já passou do
  // previsto, não inventa hora: avisa que está demorando um pouco mais.
  const previsao = (() => {
    if (!pedido.asap || pedido.status === 'concluido' || pedido.status === 'cancelado') return null;
    const pMin = pedido.loja?.tempoPreparoMin;
    const pMax = pedido.loja?.tempoPreparoMax;
    const desl = pedido.tipo === 'entrega' ? (pedido.deslocamentoMin ?? 15) : 0;
    const titulo = pedido.tipo === 'entrega' ? tt.previsaoEntrega : tt.previsaoRetirada;
    if (pedido.status === 'chegou') return { titulo, texto: tt.emInstantes, atraso: false };
    if (pedido.status === 'saiu_entrega') {
      const saiu = horaDe('saiu_entrega');
      if (saiu == null) return null;
      const chega = saiu + desl * MIN;
      return chega > agoraMs
        ? { titulo, texto: `~${hhmm(chega)}`, atraso: false }
        : { titulo, texto: tt.emInstantes, atraso: false };
    }
    if (pedido.status === 'pronto') {
      if (pedido.tipo !== 'entrega') return null;
      const pronto = horaDe('pronto') ?? agoraMs;
      const chega = Math.max(pronto, agoraMs) + (desl + 5) * MIN;
      return { titulo, texto: `~${hhmm(chega)}`, atraso: false };
    }
    if (pMin == null || pMax == null) return null;
    const base = horaDe('pago');
    if (base == null) return null;
    const ini = base + (pMin + desl) * MIN;
    const fim = base + (pMax + desl) * MIN;
    if (fim < agoraMs) return { titulo, texto: null, atraso: true };
    return {
      titulo,
      texto: `${hhmm(Math.max(ini, agoraMs))} – ${hhmm(fim)}`,
      atraso: false,
    };
  })();
  const totalCents = Math.round(Number(pedido.total) * 100);
  const aguardandoPixComQr =
    pendente && pedido.pagamento.metodo === 'pix' && !!pedido.pagamento.qrCodeString;
  // Entrega grátis: em português o rótulo do servidor, como sempre; fora dele
  // o motivo traduzido (ou o "Entrega grátis" genérico do cardápio).
  const freteGratisTexto = pedido.freteGratisLabel
    ? lang === 'pt'
      ? pedido.freteGratisLabel
      : (pedido.freteGratisMotivo ? t.freteMotivo[pedido.freteGratisMotivo] : undefined) ??
        TXT_DELIVERY[lang].entregaGratis
    : null;
  const sufixoLang = lang !== 'pt' ? `?lang=${lang}` : '';

  return (
    <main
      className="mx-auto w-full max-w-lg px-4 pb-16 pt-6 lg:max-w-2xl lg:pt-10"
      lang={lang !== 'pt' ? lang : undefined}
    >
      <div className="text-center">
        <span
          className="text-2xl tracking-tight text-[var(--dlv-strong)]"
          style={{ fontFamily: 'var(--dlv-display)' }}
        >
          {pedido.loja?.nome ?? 'Prainha'}
          <span className="text-[var(--dlv-brand-dot)]">.</span>
        </span>
        <p className="mt-1 text-sm text-[var(--dlv-muted)]">
          {t.pedido} <span className="font-bold text-[var(--dlv-ink)]">#{pedido.numero}</span> ·{' '}
          {pedido.asap ? t.asap : t.agendado(fmtData(pedido.agendadoData), pedido.agendadoHora)}
        </p>
      </div>

      {/* ---- pagamento pendente ---- */}
      {pendente ? (
        <section className="mt-5 rounded-2xl border border-[var(--dlv-card-line)] bg-[var(--dlv-card)] p-5">
          <h2 className="text-base font-bold text-[var(--dlv-ink)]">
            {t.faltaPagamento(brl(pedido.total))}
          </h2>
          <p className="mt-1 text-xs text-[var(--dlv-muted)]">
            {t.explicaPagamento}
          </p>

          {erro ? <p className="mt-2 text-xs font-semibold text-rose-700">{erro}</p> : null}

          {!mostrarCartao ? (
            aguardandoPixComQr ? (
              <div className="mt-4 text-center">
                {pedido.pagamento.qrCodeBase64 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`data:image/png;base64,${pedido.pagamento.qrCodeBase64}`}
                    alt={t.qrAlt}
                    className="mx-auto h-52 w-52 rounded-md border border-[var(--dlv-card-line)]"
                  />
                ) : null}
                <p className="mt-2 text-xs text-[var(--dlv-muted)]">
                  {t.qrInstrucao}
                </p>
                <button
                  onClick={() => void copiarPix()}
                  className="mt-2 w-full rounded-full bg-[var(--dlv-escuro)] px-4 py-3 text-sm font-semibold text-[var(--dlv-accent-ink)]"
                >
                  {copiado ? t.copiado : t.copiar}
                </button>
                <p className="mt-3 text-xs text-[var(--dlv-muted)]">
                  {t.pagouAviso}
                </p>
              </div>
            ) : (
              <button
                onClick={() => void gerarPix()}
                disabled={gerandoPix}
                className="mt-4 w-full rounded-full bg-[var(--dlv-escuro)] px-4 py-3 text-sm font-semibold text-[var(--dlv-accent-ink)] disabled:opacity-50"
              >
                {gerandoPix ? t.gerandoPix : t.gerarPix}
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
                lang={lang}
                preenchido={{
                  cpfMascarado: pedido.clienteCpfMascarado ?? null,
                  telefone: pedido.clienteTelefone ?? null,
                  endereco: pedido.tipo === 'entrega' ? pedido.endereco : null,
                }}
                onPreferirPix={() => void gerarPix()}
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
            {mostrarCartao ? t.preferePix : t.prefereCartao}
          </button>
        </section>
      ) : null}

      {/* ---- cancelado ---- */}
      {cancelado ? (
        <section className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center">
          <p className="text-base font-bold text-rose-700">{t.cancelado}</p>
          {pedido.canceladoMotivo ? (
            <p className="mt-1 text-sm text-rose-700/80">{pedido.canceladoMotivo}</p>
          ) : null}
          {pedido.pagamento.status === 'reembolsado' ? (
            <p className="mt-2 text-xs text-rose-700/80">
              {t.estornado}
            </p>
          ) : null}
          {pedido.loja?.slug ? (
            <a
              href={`/delivery/${pedido.loja.slug}${sufixoLang}`}
              className="mt-3 inline-block rounded-full bg-[var(--dlv-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--dlv-accent-ink)]"
            >
              {t.novoPedido}
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
              const quando = feito ? horaDe(e.id) : null;
              const minDesde =
                atual && quando != null && pedido.status !== 'concluido'
                  ? Math.max(0, Math.floor((agoraMs - quando) / MIN))
                  : null;
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
                    {atual && pedido.status === 'pago' ? t.obrigado : ''}
                    {minDesde != null ? (
                      <span className="ml-1 text-xs font-normal text-[var(--dlv-muted)]">
                        · {tt.ha(minDesde)}
                      </span>
                    ) : null}
                  </span>
                  {quando != null ? (
                    <span className="ml-auto text-xs tabular-nums text-[var(--dlv-muted)]">
                      {hhmm(quando)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {previsao ? (
            <div className="mt-3 rounded-xl bg-[var(--dlv-surface)] px-3 py-2 text-sm text-[var(--dlv-text)]">
              {previsao.atraso ? (
                <span>⏱ {tt.atraso}</span>
              ) : (
                <span>
                  ⏱ {previsao.titulo}: <b className="text-[var(--dlv-ink)]">{previsao.texto}</b>
                </span>
              )}
            </div>
          ) : null}
          {pedido.codigoEntrega ? (
            <div className="mt-3 rounded-xl border-2 border-dashed border-[var(--dlv-brand-dot)] bg-[var(--dlv-surface)] px-3 py-3 text-center">
              <p className="text-xs text-[var(--dlv-muted)]">
                {CODIGO_ENTREGA_TXT[lang]?.titulo ?? CODIGO_ENTREGA_TXT.pt.titulo}
              </p>
              <p className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-[var(--dlv-ink)]">
                {pedido.codigoEntrega}
              </p>
              <p className="mt-1 text-[11px] text-[var(--dlv-muted)]">
                {CODIGO_ENTREGA_TXT[lang]?.dica ?? CODIGO_ENTREGA_TXT.pt.dica}
              </p>
              {recebiPergunta ? (
                <div className="mt-3 border-t border-[var(--dlv-brand-dot)] pt-3">
                  <p className="text-sm text-[var(--dlv-ink)]">{rt.pergunta}</p>
                  <div className="mt-2 flex justify-center gap-2">
                    <button
                      disabled={recebiEnviando}
                      onClick={() => void confirmarRecebi()}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {recebiEnviando ? '…' : rt.sim}
                    </button>
                    <button
                      disabled={recebiEnviando}
                      onClick={() => setRecebiPergunta(false)}
                      className="rounded-lg border border-[var(--dlv-muted)] px-4 py-2 text-sm text-[var(--dlv-text)]"
                    >
                      {rt.nao}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setRecebiMsg(null);
                    setRecebiPergunta(true);
                  }}
                  className="mt-3 rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700"
                >
                  ✓ {rt.botao}
                </button>
              )}
            </div>
          ) : null}
          {recebiMsg ? (
            <p className="mt-2 text-center text-sm text-[var(--dlv-text)]">{recebiMsg}</p>
          ) : null}
          {pedido.pagamento.metodo === 'na_entrega' && pedido.status !== 'concluido' ? (
            <p className="mt-3 rounded-xl bg-[var(--dlv-surface)] px-3 py-2 text-xs text-[var(--dlv-text)]">
              💳 <b>{t.pagEntregaTitulo}</b>
              {t.pagEntregaResto(brl(pedido.total))}
            </p>
          ) : null}
          {pedido.status === 'pago' &&
          pedido.loja?.tempoPreparoMin != null &&
          pedido.loja?.tempoPreparoMax != null &&
          pedido.asap ? (
            <p className="mt-3 text-xs text-[var(--dlv-muted)]">
              {t.tempoEstimado(pedido.loja.tempoPreparoMin, pedido.loja.tempoPreparoMax)}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ---- resumo ---- */}
      <section className="mt-3 rounded-2xl border border-[var(--dlv-card-line)] bg-[var(--dlv-card)] p-5">
        <p className={lbl}>{t.resumo}</p>
        <ul className="mt-2 divide-y divide-[var(--dlv-surface)]">
          {pedido.itens.map((i, idx) => (
            <li key={idx} className="flex justify-between py-2 text-sm">
              <span className="text-[var(--dlv-text)]">
                {i.qtd}× {tr(i.nome)}
                {i.complementos?.length ? (
                  <span className="block text-xs text-[var(--dlv-muted)]">
                    + {i.complementos.map((c) => tr(c.nome)).join(', ')}
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
            <span>{t.subtotal}</span>
            <span>{brl(pedido.subtotal)}</span>
          </div>
          {Number(pedido.desconto) > 0 ? (
            <div className="flex justify-between text-emerald-700">
              <span>
                {t.cupom} {pedido.cupomCodigo}
              </span>
              <span>− {brl(pedido.desconto)}</span>
            </div>
          ) : null}
          {pedido.tipo === 'entrega' ? (
            <div className="flex justify-between text-[var(--dlv-text)]">
              <span>
                {t.entrega}
                {pedido.freteGratisLabel ? t.gratisSufixo : ''}
              </span>
              <span>{Number(pedido.taxaEntrega) === 0 ? 'R$ 0,00 🎉' : brl(pedido.taxaEntrega)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-bold text-[var(--dlv-ink)]">
            <span>{t.total}</span>
            <span>{brl(pedido.total)}</span>
          </div>
        </div>
        {freteGratisTexto ? (
          <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
            {freteGratisTexto}
          </p>
        ) : null}
      </section>

      {/* ---- endereço / retirada ---- */}
      <section className="mt-3 rounded-2xl border border-[var(--dlv-card-line)] bg-[var(--dlv-card)] p-5 text-sm">
        {pedido.tipo === 'entrega' && pedido.endereco ? (
          <>
            <p className={lbl}>{t.entregarEm}</p>
            <p className="mt-1 text-[var(--dlv-text)]">
              {pedido.endereco.rua}, {pedido.endereco.numero}
              {pedido.endereco.complemento ? ` — ${pedido.endereco.complemento}` : ''} ·{' '}
              {pedido.endereco.bairro}
            </p>
            {pedido.endereco.referencia ? (
              <p className="text-xs text-[var(--dlv-muted)]">{t.ref}
                {pedido.endereco.referencia}</p>
            ) : null}
          </>
        ) : (
          <>
            <p className={lbl}>{t.retirarEm}</p>
            <p className="mt-1 text-[var(--dlv-text)]">
              {pedido.loja?.endereco
                ? `${pedido.loja.endereco.rua ?? ''}${pedido.loja.endereco.numero ? `, ${pedido.loja.endereco.numero}` : ''} · ${pedido.loja.endereco.bairro ?? ''}`
                : t.balcao}
            </p>
          </>
        )}
        {pedido.observacao ? (
          <p className="mt-2 text-xs text-[var(--dlv-muted)]">{t.obs}
            {pedido.observacao}</p>
        ) : null}
      </section>

      {pedido.loja?.whatsapp ? (
        <p className="pt-5 text-center text-xs text-[var(--dlv-muted)]">
          {t.precisaFalar}{' '}
          <a
            href={`https://wa.me/${pedido.loja.whatsapp}?text=${encodeURIComponent(t.zapTexto(pedido.numero))}`}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-[var(--dlv-strong)] underline"
          >
            {t.chamaZap}
          </a>
        </p>
      ) : null}
    </main>
  );
}
