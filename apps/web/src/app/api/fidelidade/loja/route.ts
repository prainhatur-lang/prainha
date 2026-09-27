// Cartão fidelidade chamado pelo vendas-local (sem sessão aqui).
//
// POST { f, e, s, acao, ... } — s = HMAC(PAGAR_MESA_SECRET, [f,'fidelidade',e])
//   acao 'consultar' { codigo, consumo }        → prévia do desconto (não segura o código)
//   acao 'reservar'  { codigo, consumo, mesa }  → segura o código pra essa conta
//   acao 'confirmar' { uso_id, txid }           → Pix caiu: conta visita, troca o código
//   acao 'liberar'   { uso_id }                 → Pix abandonado
//
// consumo = valor dos ITENS da conta (sem taxa de serviço) — é a base do %.

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MSG_ERRO, confirmarUso, liberarUso, reservarUso, simularUso, nomeCurto } from '@/lib/fidelidade/nucleo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ ok: false, error: 'corpo inválido' }, { status: 400 });
  const f = String(b.f || ''), e = Number(b.e), s = String(b.s || '');
  if (!UUID.test(f) || !Number.isFinite(e) || e * 1000 < Date.now() || !confere([f, 'fidelidade', String(e)], s)) {
    return NextResponse.json({ ok: false, error: 'assinatura inválida ou expirada' }, { status: 403 });
  }
  const acao = String(b.acao || '');
  try {
    if (acao === 'consultar' || acao === 'reservar') {
      const consumo = Number(b.consumo) || 0;
      if (acao === 'consultar') {
        const r = await simularUso(f, b.codigo, consumo);
        if (!r.ok) return NextResponse.json({ ok: false, erro: r.erro, mensagem: MSG_ERRO[r.erro] });
        const { sim } = r;
        return NextResponse.json({
          ok: true, nome: nomeCurto(sim.cartao.nome), nivel: sim.estado.nivel.nome,
          pct_nivel: sim.pctNivel, pct_bonus: sim.pctBonus, pct: sim.pct, desconto: sim.desconto,
        });
      }
      const mesa = Number.isFinite(Number(b.mesa)) && b.mesa !== null && b.mesa !== '' ? Math.trunc(Number(b.mesa)) : null;
      const r = await reservarUso(f, b.codigo, consumo, mesa);
      if (!r.ok) return NextResponse.json({ ok: false, erro: r.erro, mensagem: MSG_ERRO[r.erro] });
      const u = r.uso;
      return NextResponse.json({
        ok: true, uso_id: u.usoId, nome: u.nome, nivel: u.nivel, pct_nivel: u.pctNivel,
        pct_bonus: u.pctBonus, pct: u.pct, desconto: u.desconto, expira_em: u.expiraEm,
      });
    }
    if (acao === 'confirmar') {
      const usoId = String(b.uso_id || '');
      if (!UUID.test(usoId)) return NextResponse.json({ ok: false, error: 'uso_id inválido' }, { status: 400 });
      const r = await confirmarUso(f, usoId, b.txid ? String(b.txid) : null);
      return NextResponse.json(r, { status: r.ok ? 200 : 404 });
    }
    if (acao === 'liberar') {
      const usoId = String(b.uso_id || '');
      if (UUID.test(usoId)) await liberarUso(f, usoId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: 'ação desconhecida' }, { status: 400 });
  } catch (err) {
    console.error('[fidelidade/loja]', acao, err);
    return NextResponse.json({ ok: false, error: (err as Error)?.message || 'erro' }, { status: 500 });
  }
}
