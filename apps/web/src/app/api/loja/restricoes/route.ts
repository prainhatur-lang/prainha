// Selos de restrição alimentar da casa, pra loja filtrar o cardápio do QR.
//
//   GET ?f=<filial>&e=<expira>&s=<assinatura> → { ok, itens: [{ produto_codigo,
//        sem_gluten, sem_lactose, obs }],
//        completo, pratos: [{ produto_codigo, contem: 'gluten,ovo', revisado }] }
//
// `completo`/`pratos` (desenho de 15/10/2026): lista completa de restrições
// da tela /cardapio/restricoes. Loja antiga ignora; com `completo` falso a
// loja nova segue só com os selos sem glúten / sem lactose.
//
// Quem marca é a cozinha, na tela /cardapio (tabela produto_restricao, por
// produto da nuvem). A loja conhece o prato pelo código do Consumer
// (produto.codigo_externo = produto_local.produto_codigo), então a resposta já
// sai nesse código. Mesma assinatura HMAC do /ifood-fila (partes [f, e]).

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { calcularCasa } from '@/lib/restricoes-alimentares';

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

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const f = sp.get('f') || '';
  const e = Number(sp.get('e') || 0);
  const s = sp.get('s') || '';
  if (!/^[0-9a-f-]{36}$/i.test(f) || !Number.isFinite(e)) {
    return NextResponse.json({ ok: false, error: 'parâmetros' }, { status: 400 });
  }
  if (e * 1000 < Date.now()) return NextResponse.json({ ok: false, error: 'expirado' }, { status: 403 });
  if (!confere([f, String(e)], s)) return NextResponse.json({ ok: false, error: 'assinatura' }, { status: 403 });

  let itens: Array<{ produto_codigo: number; sem_gluten: boolean; sem_lactose: boolean; obs: string | null }> = [];
  try {
    itens = (await db.execute(sql`
      SELECT p.codigo_externo AS produto_codigo, r.sem_gluten, r.sem_lactose, r.obs
      FROM produto_restricao r
      JOIN produto p ON p.id = r.produto_id
      WHERE p.filial_id = ${f}
        AND p.codigo_externo IS NOT NULL
        AND (r.sem_gluten OR r.sem_lactose)
    `)) as unknown as typeof itens;
  } catch {
    // tabela ainda não existe (nenhuma casa marcou nada): lista vazia
  }
  let completo = false;
  let pratos: Array<{ produto_codigo: number; contem: string; revisado: boolean }> = [];
  try {
    const c = await calcularCasa(f);
    if (c) {
      completo = c.ligado;
      const vistos = new Set<number>();
      for (const p of c.pratos) {
        if (p.codigoExterno == null || vistos.has(p.codigoExterno)) continue;
        vistos.add(p.codigoExterno);
        pratos.push({ produto_codigo: p.codigoExterno, contem: p.assinatura, revisado: p.revisado });
      }
    }
  } catch {
    // tabelas novas ausentes: segue só com os selos antigos
    completo = false;
    pratos = [];
  }
  return NextResponse.json({
    ok: true,
    itens: itens.map((i) => ({ ...i, produto_codigo: Number(i.produto_codigo) })),
    completo,
    pratos,
  });
}
