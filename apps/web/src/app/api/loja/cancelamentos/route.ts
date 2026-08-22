// CANCELAMENTOS DO CAIXA → NUVEM. O vendas-local manda em lote o que gravou na
// tabela local `cancelamento` (item ou pedido inteiro, com motivo e quem
// autorizou); aqui entra em cancelamento_item pro dashboard.
//
// Idempotente: (filial_id, id_local) — reenviar o mesmo lote só atualiza.
// Auth: a MESMA assinatura HMAC do /api/nfce/emitir (PAGAR_MESA_SECRET, que a
// loja já tem no start.bat). Assina [f, 'cancel', e].
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

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

function autoriza(f: string, e: number, s: string) {
  return /^[0-9a-f-]{36}$/i.test(f) && e * 1000 >= Date.now() && confere([f, 'cancel', String(e)], s);
}

const Linha = z.object({
  id: z.coerce.number().int().positive(),
  quando: z.string().min(10),
  login: z.string().max(60).nullable().optional(),
  gerente: z.string().max(60).nullable().optional(),
  numero: z.coerce.number().int().nullable().optional(),
  pedido_fb: z.coerce.number().int().nullable().optional(),
  item_codigo: z.coerce.number().int().nullable().optional(),
  nome: z.string().max(300).nullable().optional(),
  valor: z.coerce.number().nullable().optional(),
  status_item: z.string().max(20).nullable().optional(),
  motivo: z.string().max(500).nullable().optional(),
  area_codigo: z.coerce.number().int().nullable().optional(),
});
const Body = z.object({
  f: z.string(),
  e: z.coerce.number(),
  s: z.string(),
  cancelamentos: z.array(Linha).max(500),
});

/** POST {f,e,s,cancelamentos:[...]} — grava/atualiza o lote. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400 });
  const { f, e, s, cancelamentos } = parsed.data;
  if (!autoriza(f, e, s)) return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  if (cancelamentos.length === 0) return NextResponse.json({ ok: true, recebidos: 0, ultimo_id: null });

  const { db, schema } = await import('@concilia/db');
  const { sql } = await import('drizzle-orm');

  const valores = cancelamentos
    .filter((c) => !Number.isNaN(new Date(c.quando).getTime()))
    .map((c) => ({
      filialId: f,
      idLocal: c.id,
      quando: new Date(c.quando),
      tipo: c.item_codigo == null || c.status_item === 'pedido' ? 'pedido' : 'item',
      login: c.login ?? null,
      gerente: c.gerente ?? null,
      numero: c.numero ?? null,
      pedidoFb: c.pedido_fb ?? null,
      itemCodigo: c.item_codigo ?? null,
      nome: c.nome ?? null,
      valor: c.valor == null ? null : c.valor.toFixed(2),
      statusItem: c.status_item ?? null,
      motivo: c.motivo ?? null,
      areaCodigo: c.area_codigo ?? null,
    }));

  if (valores.length > 0) {
    await db
      .insert(schema.cancelamentoItem)
      .values(valores)
      .onConflictDoUpdate({
        target: [schema.cancelamentoItem.filialId, schema.cancelamentoItem.idLocal],
        set: {
          quando: sql`excluded.quando`,
          tipo: sql`excluded.tipo`,
          login: sql`excluded.login`,
          gerente: sql`excluded.gerente`,
          numero: sql`excluded.numero`,
          pedidoFb: sql`excluded.pedido_fb`,
          itemCodigo: sql`excluded.item_codigo`,
          nome: sql`excluded.nome`,
          valor: sql`excluded.valor`,
          statusItem: sql`excluded.status_item`,
          motivo: sql`excluded.motivo`,
          areaCodigo: sql`excluded.area_codigo`,
        },
      });
  }
  const ultimo = cancelamentos.reduce((m, c) => Math.max(m, c.id), 0);
  return NextResponse.json({ ok: true, recebidos: valores.length, ultimo_id: ultimo });
}
