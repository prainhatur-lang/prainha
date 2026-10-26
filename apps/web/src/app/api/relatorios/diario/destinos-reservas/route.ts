// /api/relatorios/diario/destinos-reservas — quem recebe às 07:00 a lista de
// reservas de hoje, por casa (20/10/2026). Só o dono configura.
//   GET  → lista salva
//   POST { destinos } → salva
//   POST { enviarAgora: true, telefone? } → manda a lista de hoje agora (todos ou só um)

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@concilia/db';
import type { DestinoReservasConfig } from '@concilia/db/schema';
import { exigirPermApi } from '@/lib/exigir-perm';
import { hojeBr } from '@/lib/datas';
import { normalizarTelefone, organizacoesDoDono } from '@/lib/relatorio-diario-envio';
import { destinosReservas, enviarReservasDoDia, salvarDestinosReservas } from '@/lib/reservas-do-dia-envio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

async function organizacaoDoDono(userId: string, pedida?: string | null) {
  const orgs = await organizacoesDoDono(userId);
  return (pedida ? orgs.find((o) => o.id === pedida) : orgs[0]) ?? null;
}

export async function GET(req: Request) {
  const guard = await exigirPermApi('relatorio.read');
  if (guard.error) return guard.error;
  const org = await organizacaoDoDono(guard.user.id, new URL(req.url).searchParams.get('organizacaoId'));
  if (!org) return NextResponse.json({ error: 'só o Admin configura o envio' }, { status: 403 });
  return NextResponse.json({ ok: true, destinos: await destinosReservas(org.id) });
}

export async function POST(req: Request) {
  const guard = await exigirPermApi('relatorio.read');
  if (guard.error) return guard.error;
  const body = (await req.json().catch(() => null)) as
    | { organizacaoId?: string; destinos?: unknown; enviarAgora?: boolean; telefone?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'corpo inválido' }, { status: 400 });
  const org = await organizacaoDoDono(guard.user.id, body.organizacaoId);
  if (!org) return NextResponse.json({ error: 'só o Admin configura o envio' }, { status: 403 });

  if (body.enviarAgora) {
    const soTelefone = body.telefone ? normalizarTelefone(body.telefone) ?? undefined : undefined;
    const envios = await enviarReservasDoDia({ organizacaoId: org.id, dia: hojeBr(), origem: 'manual', soTelefone });
    return NextResponse.json({ ok: true, envios });
  }

  if (!Array.isArray(body.destinos)) return NextResponse.json({ error: 'corpo inválido' }, { status: 400 });
  const daOrg = (await db.execute(sql`
    SELECT id FROM filial WHERE organizacao_id = ${org.id}::uuid
  `)) as unknown as Array<{ id: string }>;
  const ids = new Set(daOrg.map((f) => f.id));

  const destinos: DestinoReservasConfig[] = [];
  for (const [i, bruto] of (body.destinos as Array<Record<string, unknown>>).slice(0, 40).entries()) {
    const nome = String(bruto?.nome ?? '').trim().slice(0, 40);
    const telefone = normalizarTelefone(String(bruto?.telefone ?? ''));
    const filialIds = (Array.isArray(bruto?.filialIds) ? bruto.filialIds : []).map(String).filter((f) => ids.has(f));
    const linha = nome || `linha ${i + 1}`;
    if (!telefone) return NextResponse.json({ error: `${linha}: WhatsApp inválido (DDD + número).` }, { status: 400 });
    if (!filialIds.length) return NextResponse.json({ error: `${linha}: escolha pelo menos uma casa.` }, { status: 400 });
    destinos.push({ nome: nome || telefone, telefone, filialIds: [...new Set(filialIds)], ativo: bruto?.ativo !== false });
  }
  await salvarDestinosReservas(org.id, destinos, guard.user.id);
  return NextResponse.json({ ok: true, destinos });
}
