// GET /api/cron/vale-transporte
// Pedido do dono (23/10/2026): a partir de novembro quem lança o VT é o
// sistema, pela escala. Roda dia 1 e dia 16 (08:30 UTC → 05:30 BRT) e, em
// cada casa, lança a quinzena que começa hoje: dias da escala do mês
// (/rh/escala-mensal) × valor do dia, mais o acerto da quinzena anterior
// (ponto − pago: abate o que pagou a mais, soma o que ficou devendo).
// Gera uma conta a pagar por pessoa, igual ao 10% — mesma função do botão
// da tela /rh/vale-transporte. Quinzena já lançada (à mão ou pelo cron) é
// pulada, então rodar de novo não duplica.
// ?inicio=AAAA-MM-01|16 força uma quinzena (só a partir de 01/11/2026).
// ?antecipar=1 (pedido do dono 03/11/2026): roda todo dia às 00:00 UTC
// (21:00 BRT) e, se hoje é o último dia da quinzena, lança a SEGUINTE — paga
// na véspera. O ponto que ainda faltar de hoje corrige na quinzena depois
// (vt_quinzena_item.dias_ponto_anterior). Outros dias: não faz nada.
// Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { hojeBr } from '@/lib/datas';
import { quinzenaDe, quinzenaSeguinte } from '@/lib/rh/vale-transporte';
import { lancarQuinzenaVt } from '@/lib/rh/vale-transporte-lancar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const COMECA_EM = '2026-11-01';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  const forcado = sp.get('inicio');
  let q;
  if (sp.get('antecipar') === '1' && !forcado) {
    const hoje = hojeBr();
    const atual = quinzenaDe(hoje);
    if (hoje !== atual.fim) return NextResponse.json({ ok: true, pulado: 'hoje não é o último dia da quinzena' });
    q = quinzenaSeguinte(atual);
  } else {
    const base = forcado && /^\d{4}-\d{2}-(01|16)$/.test(forcado) ? forcado : hojeBr();
    q = quinzenaDe(base);
  }
  if (q.inicio < COMECA_EM) {
    return NextResponse.json({ ok: true, pulado: `VT automático começa em ${COMECA_EM}`, quinzena: q.inicio });
  }

  const filiais = await db.select({ id: schema.filial.id, nome: schema.filial.nome }).from(schema.filial);
  const casas: Array<Record<string, unknown>> = [];
  for (const f of filiais) {
    try {
      const r = await lancarQuinzenaVt({ filialId: f.id, por: null }, q);
      casas.push({ casa: f.nome, ...r });
    } catch (e) {
      casas.push({ casa: f.nome, ok: false, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: true, quinzena: q.inicio, casas });
}
