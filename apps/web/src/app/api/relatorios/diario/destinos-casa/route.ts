// POST /api/relatorios/diario/destinos-casa — o dono escolhe quem recebe o
// relatório por casa: para que casa(s), o que vai e se entra os 10% (18/10/2026).

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@concilia/db';
import type { DestinoCasaConfig } from '@concilia/db/schema';
import { exigirPermApi } from '@/lib/exigir-perm';
import { normalizarTelefone, organizacoesDoDono } from '@/lib/relatorio-diario-envio';
import { destinosDaOrganizacao, salvarDestinosCasa } from '@/lib/relatorio-casa-envio';
import { ultimoDiaFechado } from '@/lib/relatorio-diario';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function organizacaoDoDono(userId: string, pedida?: string | null) {
  const orgs = await organizacoesDoDono(userId);
  return (pedida ? orgs.find((o) => o.id === pedida) : orgs[0]) ?? null;
}

export async function GET(req: Request) {
  const guard = await exigirPermApi('relatorio.read');
  if (guard.error) return guard.error;
  const org = await organizacaoDoDono(guard.user.id, new URL(req.url).searchParams.get('organizacaoId'));
  if (!org) return NextResponse.json({ error: 'só o dono configura o envio' }, { status: 403 });
  return NextResponse.json({ ok: true, destinos: await destinosDaOrganizacao(org.id) });
}

export async function POST(req: Request) {
  const guard = await exigirPermApi('relatorio.read');
  if (guard.error) return guard.error;
  const body = (await req.json().catch(() => null)) as { organizacaoId?: string; destinos?: unknown } | null;
  if (!body || !Array.isArray(body.destinos)) return NextResponse.json({ error: 'corpo inválido' }, { status: 400 });
  const org = await organizacaoDoDono(guard.user.id, body.organizacaoId);
  if (!org) return NextResponse.json({ error: 'só o dono configura o envio' }, { status: 403 });

  const daOrg = (await db.execute(sql`
    SELECT id FROM filial WHERE organizacao_id = ${org.id}::uuid
  `)) as unknown as Array<{ id: string }>;
  const ids = new Set(daOrg.map((f) => f.id));
  const ontem = ultimoDiaFechado();
  const b = (v: unknown) => v === true;

  const destinos: DestinoCasaConfig[] = [];
  for (const [i, bruto] of (body.destinos as Array<Record<string, unknown>>).slice(0, 20).entries()) {
    const nome = String(bruto?.nome ?? '').trim().slice(0, 40);
    const telefone = normalizarTelefone(String(bruto?.telefone ?? ''));
    const filialIds = (Array.isArray(bruto?.filialIds) ? bruto.filialIds : []).map(String).filter((f) => ids.has(f));
    const linha = nome || `linha ${i + 1}`;
    if (!telefone) return NextResponse.json({ error: `${linha}: WhatsApp inválido (DDD + número).` }, { status: 400 });
    if (!filialIds.length) return NextResponse.json({ error: `${linha}: escolha pelo menos uma casa.` }, { status: 400 });
    const it = (bruto?.itens ?? {}) as Record<string, unknown>;
    const itens = { faturamento: b(it.faturamento), contas: b(it.contas), periodos: b(it.periodos), picos: b(it.picos) };
    if (!Object.values(itens).some(Boolean)) {
      return NextResponse.json({ error: `${linha}: marque pelo menos uma informação.` }, { status: 400 });
    }
    const desdeBruto = String(bruto?.desde ?? '');
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(desdeBruto) ? desdeBruto : ontem;
    destinos.push({
      nome: nome || telefone,
      telefone,
      filialIds: [...new Set(filialIds)],
      comServico: b(bruto?.comServico),
      itens,
      diario: b(bruto?.diario),
      mensal: b(bruto?.mensal),
      desde,
    });
  }
  await salvarDestinosCasa(org.id, destinos, guard.user.id);
  return NextResponse.json({ ok: true, destinos });
}
