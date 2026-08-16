// Cálculo de frete do delivery: geocodifica o endereço do cliente (CEP →
// coordenadas, sem chave de API), mede a distância em LINHA RETA até a loja
// e aplica as faixas + regras de frete grátis (distância, promoção por valor,
// primeira compra, cupom).
//
// Geocodificação (nesta ordem, todas gratuitas):
//   1. cep.awesomeapi.com.br  — CEP → lat/lng com precisão de RUA
//   2. Nominatim (OSM) — rua + número + bairro (precisão de rua; 1 req/s)
// Falhou tudo → o pedido NÃO trava: cobra a taxa da última faixa e o painel
// mostra "distância não calculada".
//
// ⚠️ BrasilAPI foi REMOVIDA da cadeia (16/08/2026). O `location.coordinates`
// dela é o centroide do MUNICÍPIO, não do CEP: 49008-093, 49008-250 e
// 49037-490 devolvem todos (-10.91111, -37.07167). Em produção o awesomeapi
// falhava e a cadeia caía nela, então TODO endereço de Aracaju dava 21,54 km
// da Prainha Bar e era recusado como "fora da área de entrega" — inclusive o
// vizinho da porta ao lado. Nunca reintroduzir sem checar precisão real.

import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import type { DeliveryConfig } from '@concilia/db/schema';

export interface Coordenada {
  lat: number;
  lng: number;
}

export interface EnderecoGeo {
  cep?: string;
  rua?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

const FETCH_TIMEOUT_MS = 5000;

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function numOk(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** CEP → coordenadas via awesomeapi. */
async function geoAwesomeApi(cep: string): Promise<Coordenada | null> {
  const d = (await fetchJson(`https://cep.awesomeapi.com.br/json/${cep}`)) as {
    lat?: string;
    lng?: string;
  };
  const lat = numOk(d?.lat);
  const lng = numOk(d?.lng);
  return lat != null && lng != null ? { lat, lng } : null;
}

/** Rua + número + cidade → coordenadas via Nominatim (OpenStreetMap). */
async function geoNominatim(end: EnderecoGeo): Promise<Coordenada | null> {
  const partes = [
    [end.rua, end.numero].filter(Boolean).join(' '),
    end.bairro,
    end.cidade,
    end.uf,
    'Brasil',
  ].filter(Boolean);
  if (partes.length < 2) return null;
  const q = encodeURIComponent(partes.join(', '));
  const d = (await fetchJson(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${q}`,
    { 'User-Agent': 'Concilia-Prainha/1.0 (prainhatur@gmail.com)' },
  )) as Array<{ lat?: string; lon?: string }>;
  const lat = numOk(d?.[0]?.lat);
  const lng = numOk(d?.[0]?.lon);
  return lat != null && lng != null ? { lat, lng } : null;
}

/** Geocodifica um endereço do cliente. Null se nenhuma fonte resolveu. */
export async function geocodificarEndereco(end: EnderecoGeo): Promise<Coordenada | null> {
  const cep = (end.cep ?? '').replace(/\D/g, '');
  const tentativas: Array<() => Promise<Coordenada | null>> = [];
  if (cep.length === 8) tentativas.push(() => geoAwesomeApi(cep));
  tentativas.push(() => geoNominatim(end));
  for (const t of tentativas) {
    try {
      const c = await t();
      if (c) return c;
    } catch {
      // fonte fora do ar/timeout — tenta a próxima
    }
  }
  return null;
}

/** Distância em km (linha reta) entre dois pontos. */
export function haversineKm(a: Coordenada, b: Coordenada): number {
  const R = 6371;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Status que contam como "compra de verdade" (pra 1ª compra e uso de cupom). */
export const STATUS_PAGOS = ['pago', 'em_preparo', 'pronto', 'saiu_entrega', 'concluido'];

/** True se o telefone nunca teve pedido pago nesta filial. */
export async function ehPrimeiraCompra(filialId: string, telefone: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.deliveryPedido.id })
    .from(schema.deliveryPedido)
    .where(
      and(
        eq(schema.deliveryPedido.filialId, filialId),
        eq(schema.deliveryPedido.clienteTelefone, telefone),
        inArray(schema.deliveryPedido.status, STATUS_PAGOS),
      ),
    )
    .limit(1);
  return rows.length === 0;
}

export interface ResultadoFrete {
  ok: boolean;
  erro?: string;
  /** Fora da última faixa de entrega. */
  foraDaArea?: boolean;
  /** Taxa final em centavos (0 quando grátis). */
  taxaCentavos: number;
  /** Taxa cheia (antes do grátis), em centavos. */
  taxaCheiaCentavos: number;
  /** Distância loja→cliente em km, null se não geocodificou. */
  distanciaKm: number | null;
  gratis: boolean;
  /** distancia | promocao | primeira_compra | cupom */
  motivo: 'distancia' | 'promocao' | 'primeira_compra' | 'cupom' | null;
}

/** Aplica faixas + regras de frete grátis. dist=null → última faixa (fallback). */
export function calcularFrete(params: {
  config: DeliveryConfig;
  distanciaKm: number | null;
  subtotalCentavos: number;
  primeiraCompra: boolean;
  cupomFreteGratis: boolean;
}): ResultadoFrete {
  const { config, distanciaKm, subtotalCentavos, primeiraCompra, cupomFreteGratis } = params;
  const faixas = (config.faixasEntrega ?? [])
    .filter((f) => Number.isFinite(f.ateKm) && Number.isFinite(f.taxa))
    .sort((a, b) => a.ateKm - b.ateKm);

  if (faixas.length === 0) {
    return {
      ok: false,
      erro: 'Entrega não configurada — escolha retirada.',
      taxaCentavos: 0,
      taxaCheiaCentavos: 0,
      distanciaKm,
      gratis: false,
      motivo: null,
    };
  }

  let taxaCheia: number;
  if (distanciaKm == null) {
    taxaCheia = Math.round(faixas[faixas.length - 1].taxa * 100);
  } else {
    const faixa = faixas.find((f) => distanciaKm <= f.ateKm);
    if (!faixa) {
      return {
        ok: false,
        foraDaArea: true,
        erro: `Que pena — esse endereço está fora da nossa área de entrega (até ${faixas[faixas.length - 1].ateKm} km).`,
        taxaCentavos: 0,
        taxaCheiaCentavos: 0,
        distanciaKm,
        gratis: false,
        motivo: null,
      };
    }
    taxaCheia = Math.round(faixa.taxa * 100);
  }

  let motivo: ResultadoFrete['motivo'] = null;
  if (
    distanciaKm != null &&
    config.gratisAteKm != null &&
    config.gratisAteKm > 0 &&
    distanciaKm <= config.gratisAteKm
  ) {
    motivo = 'distancia';
  } else if (
    config.gratisAcimaDe != null &&
    config.gratisAcimaDe > 0 &&
    subtotalCentavos >= Math.round(config.gratisAcimaDe * 100)
  ) {
    motivo = 'promocao';
  } else if (config.gratisPrimeiraCompra && primeiraCompra) {
    motivo = 'primeira_compra';
  } else if (cupomFreteGratis) {
    motivo = 'cupom';
  }

  const gratis = motivo != null;
  return {
    ok: true,
    taxaCentavos: gratis ? 0 : taxaCheia,
    taxaCheiaCentavos: taxaCheia,
    distanciaKm,
    gratis,
    motivo,
  };
}

export const MOTIVO_FRETE_LABEL: Record<string, string> = {
  distancia: 'Entrega grátis — você está pertinho da gente',
  promocao: 'Entrega grátis — pedido acima do valor da promoção',
  primeira_compra: 'Entrega grátis na sua primeira compra 🎉',
  cupom: 'Entrega grátis pelo cupom',
};
