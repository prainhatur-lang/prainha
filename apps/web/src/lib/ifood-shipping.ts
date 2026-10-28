// Entregador do iFood (módulo Shipping / "Sob Demanda").
//
// Dois caminhos:
//   - pedido de FORA do iFood (site/WhatsApp): cota pelo lat/lng do cliente e
//     registra um pedido externo no iFood, que aloca o entregador;
//   - pedido do PRÓPRIO iFood com entrega da loja: cota pelo id do pedido e
//     pede o entregador (requestDriver).
//
// Motivos de cancelamento vêm sempre do iFood (nunca fixos — homologação).
// 403 = o app ainda não tem o módulo Shipping liberado no Portal do Desenvolvedor.

import { randomUUID } from 'node:crypto';
import { ifoodApi, IfoodErro, explicarErroIfood, type CredIfood } from './ifood-api';

const BASE = '/shipping/v1.0';

export interface CotacaoIfood {
  quoteId: string;
  /** Valor da corrida pra loja (netValue). */
  valor: number;
  bruto: number;
  desconto: number;
  acrescimo: number;
  /** Minutos até a entrega (faixa). */
  minMin: number | null;
  maxMin: number | null;
  distanciaM: number | null;
  /** Cru, pra guardar. */
  raw: unknown;
}

/** Erros de cotação do iFood → frase pra quem está no caixa. */
const ERROS_COTACAO: Record<string, string> = {
  DeliveryDistanceTooHigh: 'endereço a mais de ~10 km da loja — o iFood não entrega tão longe',
  OffOpeningHours: 'fora do horário de operação da entrega do iFood',
  ServiceAreaMismatch: 'endereço fora da área de cobertura do iFood',
  HighDemand: 'o iFood está sem entregador por alta demanda — tente em alguns minutos',
  UnavailableFleet: 'frota do iFood indisponível agora — tente mais tarde',
  NRELimitExceeded: 'limite de entregadores simultâneos da loja atingido — espere uma entrega terminar',
  MerchantEasyDeliveryDisabled: 'a entrega Sob Demanda não está ativada pra esta loja no iFood',
  MerchantStatusAvailability: 'a conta da loja tem pendência no iFood — falar com o suporte',
  OriginNotFound: 'a loja não está cadastrada nas áreas de entrega do iFood',
  BadRequestMerchant: 'a loja está indisponível no iFood (fechada ou pausada?)',
  InvalidPaymentMethods: 'forma de pagamento não aceita pelo iFood',
  PaymentTotalInvalid: 'valor do pagamento não bate com o total do pedido',
  BadRequest: 'o iFood recusou os dados (confira o endereço/coordenadas)',
};

/** Mensagem clara pra qualquer erro do Shipping. */
export function erroShipping(e: unknown): { mensagem: string; status: number; semModulo: boolean } {
  if (e instanceof IfoodErro && (e.status === 400 || e.status === 422)) {
    let code = e.codigo;
    let msg = '';
    try {
      const j = JSON.parse(e.corpo) as { code?: string; message?: string; error?: { code?: string; message?: string } };
      code = code || String(j?.error?.code ?? j?.code ?? '');
      msg = String(j?.error?.message ?? j?.message ?? '');
    } catch { /* corpo não-JSON */ }
    if (code && ERROS_COTACAO[code]) return { mensagem: ERROS_COTACAO[code], status: 400, semModulo: false };
    return { mensagem: 'o iFood recusou' + (msg ? ': ' + msg : code ? ' (' + code + ')' : ''), status: 400, semModulo: false };
  }
  const x = explicarErroIfood(e, 'Shipping');
  return { mensagem: x.mensagem, status: x.status, semModulo: x.semModulo };
}

function lerCotacao(j: unknown): CotacaoIfood {
  const o = (j ?? {}) as {
    id?: string;
    quote?: { grossValue?: number; discount?: number; raise?: number; netValue?: number };
    deliveryTime?: { min?: number; max?: number };
    distance?: number;
  };
  const q = o.quote ?? {};
  const min = (s?: number) => (typeof s === 'number' ? Math.round(s / 60) : null);
  return {
    quoteId: String(o.id ?? ''),
    valor: Number(q.netValue ?? q.grossValue ?? 0),
    bruto: Number(q.grossValue ?? 0),
    desconto: Number(q.discount ?? 0),
    acrescimo: Number(q.raise ?? 0),
    minMin: min(o.deliveryTime?.min),
    maxMin: min(o.deliveryTime?.max),
    distanciaM: typeof o.distance === 'number' ? o.distance : null,
    raw: j,
  };
}

/** Cotação pra um pedido de fora do iFood (pelo endereço do cliente). */
export async function cotarExterno(c: CredIfood, merchantId: string, lat: number, lng: number): Promise<CotacaoIfood> {
  const j = await ifoodApi(
    c,
    `${BASE}/merchants/${merchantId}/deliveryAvailabilities?latitude=${lat}&longitude=${lng}`,
  );
  return lerCotacao(j);
}

/** Cotação pra um pedido do próprio iFood. */
export async function cotarPedidoIfood(c: CredIfood, orderId: string): Promise<CotacaoIfood> {
  const j = await ifoodApi(c, `${BASE}/orders/${orderId}/deliveryAvailabilities`);
  return lerCotacao(j);
}

export interface PedidoExterno {
  /** ≤ 4 caracteres. */
  displayId: string;
  cliente: { nome: string; telefone: string };
  endereco: {
    cep: string;
    rua: string;
    numero: string;
    complemento?: string;
    referencia?: string;
    bairro: string;
    cidade: string;
    uf: string;
    lat: number;
    lng: number;
  };
  /** Taxa de entrega cobrada do cliente. */
  taxaEntrega: number;
  /** Segundos até o pedido ficar pronto (entregador é alocado depois disso). */
  preparoSeg: number;
  quoteId?: string;
  itens: Array<{ nome: string; qtd: number; precoUnit: number; complementos: number; total: number; codigo?: string }>;
  /** null = pago online (não manda payments). */
  pagamentoNaEntrega: null | { metodo: 'CREDIT' | 'DEBIT' | 'CASH'; valor: number; bandeira?: string; trocoPara?: number };
}

const corta = (s: string | undefined, n: number) => String(s ?? '').trim().slice(0, n);

/** Telefone com 55 → partes que o iFood quer. */
function telefone(t: string): { countryCode: string; areaCode: string; number: string } {
  let d = String(t ?? '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  return { countryCode: '55', areaCode: d.slice(0, 2), number: d.slice(2, 11) };
}

/** Registra o pedido externo no iFood e o entregador é alocado. */
export async function criarPedidoExterno(
  c: CredIfood,
  merchantId: string,
  p: PedidoExterno,
): Promise<{ id: string; trackingUrl: string | null }> {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const corpo: Record<string, unknown> = {
    customer: {
      name: corta(p.cliente.nome, 50) || 'Cliente',
      phone: { ...telefone(p.cliente.telefone), type: 'CUSTOMER' },
    },
    delivery: {
      merchantFee: r2(p.taxaEntrega),
      preparationTime: Math.max(0, Math.round(p.preparoSeg)),
      ...(p.quoteId ? { quoteId: p.quoteId } : {}),
      deliveryAddress: {
        postalCode: String(p.endereco.cep).replace(/\D/g, '').slice(0, 8),
        streetNumber: corta(p.endereco.numero, 10) || 'S/N',
        streetName: corta(p.endereco.rua, 50),
        ...(p.endereco.complemento ? { complement: corta(p.endereco.complemento, 50) } : {}),
        ...(p.endereco.referencia ? { reference: corta(p.endereco.referencia, 70) } : {}),
        neighborhood: corta(p.endereco.bairro, 50),
        city: corta(p.endereco.cidade, 50),
        state: corta(p.endereco.uf, 2).toUpperCase(),
        country: 'BR',
        coordinates: { latitude: p.endereco.lat, longitude: p.endereco.lng },
      },
    },
    items: p.itens.map((i) => ({
      id: randomUUID(),
      name: corta(i.nome, 50),
      ...(i.codigo ? { externalCode: corta(i.codigo, 50) } : {}),
      quantity: i.qtd,
      unitPrice: r2(i.precoUnit),
      price: r2(i.precoUnit * i.qtd),
      optionsPrice: r2(i.complementos),
      totalPrice: r2(i.total),
    })),
    displayId: corta(p.displayId, 4),
  };
  if (p.pagamentoNaEntrega) {
    const m = p.pagamentoNaEntrega;
    corpo.payments = {
      methods: [{
        method: m.metodo,
        type: 'OFFLINE',
        value: r2(m.valor),
        ...(m.metodo === 'CASH' ? { cash: { changeFor: r2(m.trocoPara ?? 0) } } : { card: { brand: m.bandeira || 'OUTROS' } }),
      }],
    };
  }
  const r = (await ifoodApi(c, `${BASE}/merchants/${merchantId}/orders`, {
    metodo: 'POST',
    corpo,
    cru: true,
    headers: { 'idempotency-key': randomUUID() },
  })) as Response;
  const txt = await r.text();
  if (!r.ok) {
    throw new IfoodErro(
      `iFood POST ${BASE}/merchants/${merchantId}/orders → ${r.status}: ${txt.slice(0, 300)}`,
      r.status,
      (() => { try { const j = JSON.parse(txt); return String(j?.error?.code ?? j?.code ?? ''); } catch { return ''; } })(),
      txt.slice(0, 2000),
    );
  }
  let j: { id?: string; trackingUrl?: string } = {};
  try { j = JSON.parse(txt); } catch { /* 202 sem corpo */ }
  if (!j.id) throw new IfoodErro('iFood criou o pedido mas não devolveu o id', r.status, 'SEM_ID', txt.slice(0, 500));
  return { id: j.id, trackingUrl: j.trackingUrl ?? null };
}

/** Pedido criado pela Shipping chega como PLACED: a loja confirma. */
export async function confirmarPedido(c: CredIfood, orderId: string): Promise<void> {
  await ifoodApi(c, `/order/v1.0/orders/${orderId}/confirm`, {
    metodo: 'POST',
    headers: { 'idempotency-key': randomUUID() },
  });
}

/** Pede o entregador do iFood pra um pedido do iFood com entrega da loja. */
export async function solicitarEntregador(c: CredIfood, orderId: string, quoteId: string): Promise<void> {
  await ifoodApi(c, `${BASE}/orders/${orderId}/requestDriver`, {
    metodo: 'POST',
    corpo: { quoteId },
    headers: { 'idempotency-key': randomUUID() },
  });
}

export async function cancelarEntregador(c: CredIfood, orderId: string): Promise<void> {
  await ifoodApi(c, `${BASE}/orders/${orderId}/cancelRequestDriver`, {
    metodo: 'POST',
    headers: { 'idempotency-key': randomUUID() },
  });
}

/** Motivos aceitos AGORA. Lista vazia = não dá mais pra cancelar (204). */
export async function motivosCancelamento(
  c: CredIfood,
  orderId: string,
): Promise<Array<{ codigo: number; descricao: string }>> {
  const j = await ifoodApi(c, `${BASE}/orders/${orderId}/cancellationReasons`);
  const arr = Array.isArray(j) ? j : [];
  return arr
    .map((x: { cancelCodeId?: string | number; description?: string }) => ({
      codigo: Number(x.cancelCodeId),
      descricao: String(x.description ?? ''),
    }))
    .filter((x) => Number.isFinite(x.codigo));
}

/** Cancela o pedido externo inteiro (e o entregador junto). */
export async function cancelarPedidoExterno(c: CredIfood, orderId: string, codigo: number, motivo: string): Promise<void> {
  await ifoodApi(c, `${BASE}/orders/${orderId}/cancel`, {
    metodo: 'POST',
    corpo: { reason: corta(motivo, 250) || 'Cancelado pela loja', cancellationCode: codigo },
    headers: { 'idempotency-key': randomUUID() },
  });
}

/** Onde está o entregador (best effort: 404 enquanto não tem entregador). */
export async function rastreio(c: CredIfood, orderId: string): Promise<Record<string, unknown> | null> {
  try {
    const j = await ifoodApi(c, `${BASE}/orders/${orderId}/tracking`, { tentativas: 1 });
    return (j ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

/** Detalhe do pedido no iFood (traz o entregador quando já alocado). */
export async function detalhePedido(c: CredIfood, orderId: string): Promise<Record<string, unknown> | null> {
  try {
    const j = await ifoodApi(c, `/order/v1.0/orders/${orderId}`, { tentativas: 1 });
    return (j ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}
