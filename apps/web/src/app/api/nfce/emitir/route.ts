// POST /api/nfce/emitir — chamado pelo vendas-local da loja (sem sessão).
//
// Auth: mesma assinatura HMAC do /pagar-mesa e /api/cliente-documento
// (PAGAR_MESA_SECRET, que a loja já tem). Assina [f, pedidoChave, e].
//
// Idempotente: repetir o POST do mesmo pedido devolve a nota já autorizada
// (é assim que a reimpressão funciona — LIO e caixa só chamam de novo).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { emitirNfcePedido } from '@/lib/nfce/emitir';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const Item = z.object({
  codigo: z.string().max(60),
  descricao: z.string().max(200),
  quantidade: z.number().positive(),
  valorTotal: z.number().min(0),
  valorDesconto: z.number().min(0).optional(),
  valorOutro: z.number().min(0).optional(),
  unidade: z.string().max(6).optional(),
  ncm: z.string().max(12).optional(),
  cfop: z.string().max(6).optional(),
  csosn: z.string().max(4).optional(),
  origem: z.string().max(1).optional(),
});

const Pagamento = z.object({
  tPag: z.string().regex(/^\d{2}$/),
  valor: z.number().positive(),
  tBand: z.string().regex(/^\d{2}$/).optional(),
  cAut: z.string().max(40).optional(),
});

const Body = z.object({
  f: z.string().uuid(),
  e: z.number(),
  s: z.string(),
  pedido: z.object({
    pedidoChave: z.string().min(3).max(120),
    mesa: z.string().max(20).nullish(),
    documento: z.string().max(20).nullish(),
    itens: z.array(Item).min(1).max(990),
    pagamentos: z.array(Pagamento).min(1).max(50),
    valorTroco: z.number().min(0).optional(),
    infoExtra: z.string().max(2000).nullish(),
    solicitadoPor: z.string().max(60).nullish(),
  }),
});

/** GET ?f=&e=&s= — o vendas-local pergunta se a filial tem NFC-e ligada
 *  (assina [f, 'status', e]). Liga/desliga pela config fiscal no painel,
 *  sem mexer em env na loja. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const f = sp.get('f') || '';
  const e = Number(sp.get('e') || 0);
  const s = sp.get('s') || '';
  if (!/^[0-9a-f-]{36}$/i.test(f) || e * 1000 < Date.now() || !confere([f, 'status', String(e)], s)) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  const { db, schema } = await import('@concilia/db');
  const { eq } = await import('drizzle-orm');
  const [fil] = await db
    .select({ cfg: schema.filial.fiscalConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, f))
    .limit(1);
  const cfg = fil?.cfg;
  return NextResponse.json({
    ok: true,
    ativo: !!cfg?.ativo,
    ambiente: cfg?.ambiente === 1 ? 1 : 2,
  });
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, erro: 'body inválido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { f, e, s, pedido } = parsed.data;
  if (e * 1000 < Date.now()) {
    return NextResponse.json({ ok: false, erro: 'assinatura expirada' }, { status: 403 });
  }
  if (!confere([f, pedido.pedidoChave, String(e)], s)) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }

  try {
    const r = await emitirNfcePedido(f, pedido);
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  } catch (err) {
    console.error('[nfce/emitir]', err);
    return NextResponse.json(
      { ok: false, erro: `erro interno: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
