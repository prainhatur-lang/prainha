// POST /api/delivery/[slug]/frete — prévia da taxa de entrega no checkout:
// geocodifica o endereço, mede a distância até a loja e aplica faixas +
// regras de frete grátis (distância / promoção / primeira compra / cupom).
// Público. O valor FINAL é recalculado de novo na criação do pedido.

import { NextResponse } from 'next/server';
import { lojaDeliveryPorSlug } from '@/lib/delivery/config';
import {
  calcularFrete,
  ehPrimeiraCompra,
  geocodificarEndereco,
  haversineKm,
  MOTIVO_FRETE_LABEL,
} from '@/lib/delivery/frete';
import { normTelefone } from '@/lib/delivery/pedido';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loja = await lojaDeliveryPorSlug(slug);
  if (!loja) return NextResponse.json({ error: 'loja não encontrada' }, { status: 404 });
  if (loja.config.entregaAtiva === false) {
    return NextResponse.json({ error: 'entrega desativada' }, { status: 400 });
  }

  const b = await request.json().catch(() => null);
  const txt = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
  const endereco = {
    cep: txt(b?.cep, 9),
    rua: txt(b?.rua, 160),
    numero: txt(b?.numero, 20),
    bairro: txt(b?.bairro, 80),
    cidade: txt(b?.cidade, 80) ?? loja.config.endereco?.cidade,
    uf: txt(b?.uf, 2) ?? loja.config.endereco?.uf,
  };
  if (!endereco.rua || !endereco.bairro) {
    return NextResponse.json({ error: 'informe rua e bairro' }, { status: 400 });
  }
  const subtotalCentavos =
    Number.isFinite(Number(b?.subtotalCentavos)) && Number(b.subtotalCentavos) > 0
      ? Math.round(Number(b.subtotalCentavos))
      : 0;
  const telefone = normTelefone(typeof b?.telefone === 'string' ? b.telefone : null);
  const cupomFreteGratis = b?.cupomFreteGratis === true;

  const lojaCoord =
    loja.config.endereco?.lat != null && loja.config.endereco?.lng != null
      ? { lat: loja.config.endereco.lat, lng: loja.config.endereco.lng }
      : null;

  let distanciaKm: number | null = null;
  if (lojaCoord) {
    const destino = await geocodificarEndereco(endereco);
    if (destino) distanciaKm = Math.round(haversineKm(lojaCoord, destino) * 100) / 100;
  }

  const primeiraCompra =
    loja.config.gratisPrimeiraCompra && telefone
      ? await ehPrimeiraCompra(loja.filialId, telefone)
      : false;

  const frete = calcularFrete({
    config: loja.config,
    distanciaKm,
    subtotalCentavos,
    primeiraCompra,
    cupomFreteGratis,
  });

  return NextResponse.json({
    ok: frete.ok,
    erro: frete.erro ?? null,
    foraDaArea: frete.foraDaArea === true,
    taxaCentavos: frete.taxaCentavos,
    taxaCheiaCentavos: frete.taxaCheiaCentavos,
    distanciaKm: frete.distanciaKm,
    gratis: frete.gratis,
    motivo: frete.motivo,
    motivoLabel: frete.motivo ? MOTIVO_FRETE_LABEL[frete.motivo] : null,
  });
}
