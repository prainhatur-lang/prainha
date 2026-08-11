// GET/PUT /api/delivery-admin/config?filialId= — configuração do delivery da
// filial (jsonb delivery_config). O PUT sobrescreve a config inteira depois de
// sanitizar campo a campo; o que não vier no corpo volta pro default.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import type { DeliveryConfig, DeliveryFaixa, DeliveryJanela } from '@concilia/db/schema';
import { eq, ne, and, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { geocodificarEndereco } from '@/lib/delivery/frete';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const hm = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const txt = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('delivery.read');
  if (error) return error;

  const filialId = new URL(request.url).searchParams.get('filialId') ?? '';
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const [row] = await db
    .select({ config: schema.filial.deliveryConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  return NextResponse.json({ config: row?.config ?? null });
}

export async function PUT(request: Request) {
  const { user, error } = await exigirPermApi('delivery.configurar');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  if (!filialId) return NextResponse.json({ error: 'filialId obrigatório' }, { status: 400 });

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const slug = (txt(b?.slug, 40) ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (b?.ativo === true && !slug) {
    return NextResponse.json({ error: 'defina o endereço (slug) da loja' }, { status: 400 });
  }
  if (slug) {
    const conflito = await db
      .select({ id: schema.filial.id })
      .from(schema.filial)
      .where(
        and(
          ne(schema.filial.id, filialId),
          sql`${schema.filial.deliveryConfig}->>'slug' = ${slug}`,
        ),
      )
      .limit(1);
    if (conflito.length > 0) {
      return NextResponse.json({ error: 'esse endereço já é usado por outra loja' }, { status: 409 });
    }
  }

  // Config atual: preserva as coordenadas já geocodificadas se o endereço
  // não mudou (evita bater no Nominatim a cada salvada).
  const [row] = await db
    .select({ config: schema.filial.deliveryConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const atual: DeliveryConfig = row?.config ?? {};

  const faixas: DeliveryFaixa[] = Array.isArray(b?.faixasEntrega)
    ? b.faixasEntrega
        .map((f: unknown) => {
          const o = f as { ateKm?: unknown; taxa?: unknown };
          const ateKm = num(o?.ateKm);
          const taxa = num(o?.taxa);
          return ateKm != null && ateKm > 0 && taxa != null ? { ateKm, taxa } : null;
        })
        .filter((f: DeliveryFaixa | null): f is DeliveryFaixa => f != null)
        .sort((a: DeliveryFaixa, z: DeliveryFaixa) => a.ateKm - z.ateKm)
    : [];

  const horarios: Record<number, DeliveryJanela[]> = {};
  if (b?.horarios && typeof b.horarios === 'object') {
    for (let d = 0; d <= 6; d++) {
      const lista = (b.horarios as Record<number, unknown>)[d];
      if (!Array.isArray(lista)) continue;
      const janelas = lista
        .map((j: unknown) => {
          const o = j as { abre?: unknown; fecha?: unknown };
          const abre = hm(o?.abre);
          const fecha = hm(o?.fecha);
          return abre && fecha && fecha > abre ? { abre, fecha } : null;
        })
        .filter((j): j is DeliveryJanela => j != null);
      if (janelas.length > 0) horarios[d] = janelas;
    }
  }

  const endereco = {
    cep: txt(b?.endereco?.cep, 9),
    rua: txt(b?.endereco?.rua, 160),
    numero: txt(b?.endereco?.numero, 20),
    bairro: txt(b?.endereco?.bairro, 80),
    cidade: txt(b?.endereco?.cidade, 80),
    uf: txt(b?.endereco?.uf, 2),
    lat: undefined as number | undefined,
    lng: undefined as number | undefined,
  };
  const mudouEndereco =
    endereco.cep !== atual.endereco?.cep ||
    endereco.rua !== atual.endereco?.rua ||
    endereco.numero !== atual.endereco?.numero;
  if (!mudouEndereco && atual.endereco?.lat != null && atual.endereco?.lng != null) {
    endereco.lat = atual.endereco.lat;
    endereco.lng = atual.endereco.lng;
  } else if (endereco.rua || endereco.cep) {
    const c = await geocodificarEndereco(endereco);
    if (c) {
      endereco.lat = c.lat;
      endereco.lng = c.lng;
    }
  }
  // Coordenada manual do painel tem prioridade sobre a geocodificada.
  const latManual = Number(b?.endereco?.lat);
  const lngManual = Number(b?.endereco?.lng);
  if (Number.isFinite(latManual) && Number.isFinite(lngManual) && latManual !== 0) {
    endereco.lat = latManual;
    endereco.lng = lngManual;
  }

  const config: DeliveryConfig = {
    ativo: b?.ativo === true,
    pausado: b?.pausado === true,
    slug: slug || undefined,
    titulo: txt(b?.titulo, 120),
    subtitulo: txt(b?.subtitulo, 200),
    avisoTopo: txt(b?.avisoTopo, 300),
    whatsapp: (txt(b?.whatsapp, 20) ?? '').replace(/\D/g, '') || undefined,
    endereco,
    retiradaAtiva: b?.retiradaAtiva !== false,
    entregaAtiva: b?.entregaAtiva !== false,
    pedidoMinimo: num(b?.pedidoMinimo),
    faixasEntrega: faixas,
    gratisAteKm: num(b?.gratisAteKm),
    gratisAcimaDe: num(b?.gratisAcimaDe),
    gratisPrimeiraCompra: b?.gratisPrimeiraCompra === true,
    horarios,
    slotMinutos: Math.min(Math.max(Number(b?.slotMinutos) || 30, 10), 120),
    antecedenciaMinutos: Math.min(Math.max(Number(b?.antecedenciaMinutos) || 45, 0), 480),
    diasFuturos: Math.min(Math.max(Number(b?.diasFuturos) || 7, 1), 30),
    diasFechados: Array.isArray(b?.diasFechados)
      ? b.diasFechados
          .filter((d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
          .slice(0, 60)
      : [],
    tempoPreparoMin: num(b?.tempoPreparoMin) ?? undefined,
    tempoPreparoMax: num(b?.tempoPreparoMax) ?? undefined,
    pixAtivo: b?.pixAtivo !== false,
    cartaoAtivo: b?.cartaoAtivo !== false,
  };

  if (config.ativo && config.entregaAtiva && faixas.length === 0 && !config.retiradaAtiva) {
    return NextResponse.json(
      { error: 'configure ao menos uma faixa de entrega (ou ative a retirada)' },
      { status: 400 },
    );
  }

  await db
    .update(schema.filial)
    .set({ deliveryConfig: config })
    .where(eq(schema.filial.id, filialId));

  return NextResponse.json({ ok: true, config });
}
