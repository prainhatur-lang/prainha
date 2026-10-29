// POST /api/marketing/anuncios/impulsionar — impulsiona um post do Instagram da casa.
// { filialId, midiaId, objetivo: 'alcance'|'engajamento', porDia, dias, raioKm,
//   idadeMin, idadeMax, soInstagram, confirmoTotal }
// confirmoTotal tem que ser porDia × dias (a pessoa confirmou o valor na tela).
// Cria campanha + conjunto + anúncio na conta de anúncios da casa; o nome leva
// "Concilia · casa · data · quem", pra achar no Gerenciador.

import { NextResponse } from 'next/server';
import { acessoMarketingApi } from '@/lib/marketing/acesso';
import { CENTRO_CASA, ligacaoAnuncios } from '@/lib/marketing/anuncios-ligacao';
import { ErroMeta, impulsionarPost } from '@/lib/marketing/meta-ads';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const entre = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as {
    filialId?: string;
    midiaId?: string;
    objetivo?: string;
    porDia?: number;
    dias?: number;
    raioKm?: number;
    idadeMin?: number;
    idadeMax?: number;
    soInstagram?: boolean;
    confirmoTotal?: number;
    igId?: string;
  };
  const acesso = await acessoMarketingApi(b.filialId);
  if (acesso.error) return acesso.error;
  const { user, casa } = acesso;
  const l = await ligacaoAnuncios(casa.id);
  if (!l?.contaId) return NextResponse.json({ error: 'Casa sem conta de anúncios conectada.' }, { status: 400 });
  const igId = (b.igId ?? '').trim() || l.igId;
  if (!igId) return NextResponse.json({ error: 'A conta de anúncios não está ligada a um Instagram. Escolha na tela.' }, { status: 400 });
  const centro = CENTRO_CASA[casa.id];
  if (!centro) return NextResponse.json({ error: 'Casa sem localização pra mirar o público.' }, { status: 400 });

  if (!b.midiaId || !/^\d+$/.test(b.midiaId)) return NextResponse.json({ error: 'Escolha o post.' }, { status: 400 });
  if (b.objetivo !== 'alcance' && b.objetivo !== 'engajamento')
    return NextResponse.json({ error: 'Objetivo?' }, { status: 400 });
  if (!entre(b.porDia, 6, 1000)) return NextResponse.json({ error: 'Valor por dia entre R$ 6 e R$ 1.000.' }, { status: 400 });
  if (!entre(b.dias, 1, 30) || !Number.isInteger(b.dias)) return NextResponse.json({ error: 'De 1 a 30 dias.' }, { status: 400 });
  if (!entre(b.raioKm, 1, 80)) return NextResponse.json({ error: 'Raio de 1 a 80 km.' }, { status: 400 });
  const idadeMin = entre(b.idadeMin, 18, 65) ? Math.round(b.idadeMin!) : 18;
  const idadeMax = entre(b.idadeMax, idadeMin, 65) ? Math.round(b.idadeMax!) : 65;
  const total = Math.round(b.porDia! * b.dias! * 100) / 100;
  if (typeof b.confirmoTotal !== 'number' || Math.abs(b.confirmoTotal - total) > 0.009)
    return NextResponse.json({ error: `Confirme o total de R$ ${total.toFixed(2)}.` }, { status: 400 });

  const [a, m, d] = hojeBr().split('-');
  const quem = (user.email ?? '').split('@')[0];
  try {
    const r = await impulsionarPost(l.accessToken, {
      contaId: l.contaId,
      igId,
      paginaId: igId === l.igId ? l.paginaId || null : null,
      midiaId: b.midiaId,
      nome: `Concilia · ${casa.nome} · ${d}/${m}/${a} · ${quem}`,
      objetivo: b.objetivo,
      porDia: b.porDia!,
      dias: b.dias!,
      lat: centro.lat,
      lng: centro.lng,
      raioKm: b.raioKm!,
      idadeMin,
      idadeMax,
      soInstagram: !!b.soInstagram,
      pausado: false,
    });
    return NextResponse.json({ ok: true, ...r, total });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ErroMeta ? e.message : String(e) }, { status: 400 });
  }
}
