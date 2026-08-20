// FILA DE FIADO: a nuvem enfileira, a LOJA aplica.
//
// A tela do Financeiro não escreve no Firebird — quem tem o banco é a loja, e
// a nuvem não alcança a loja. Então o vendas-local pergunta aqui o que há pra
// lançar (GET), aplica na CONTACORRENTE e devolve o resultado (POST).
//
// Auth: a MESMA assinatura HMAC do /api/nfce/emitir (PAGAR_MESA_SECRET, que a
// loja já tem no start.bat). Assina [f, 'fiado', e].
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

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
  return /^[0-9a-f-]{36}$/i.test(f) && e * 1000 >= Date.now() && confere([f, 'fiado', String(e)], s);
}

/** GET ?f=&e=&s= — o que está pendente pra esta filial (no máximo 20). */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const f = sp.get('f') || '';
  if (!autoriza(f, Number(sp.get('e') || 0), sp.get('s') || '')) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  const { db, schema } = await import('@concilia/db');
  const { and, eq, asc } = await import('drizzle-orm');
  const linhas = await db
    .select({
      id: schema.fiadoLancamento.id,
      cliente: schema.fiadoLancamento.clienteCodigoExterno,
      tipo: schema.fiadoLancamento.tipo,
      valor: schema.fiadoLancamento.valor,
      observacao: schema.fiadoLancamento.observacao,
    })
    .from(schema.fiadoLancamento)
    .where(and(eq(schema.fiadoLancamento.filialId, f), eq(schema.fiadoLancamento.status, 'pendente')))
    .orderBy(asc(schema.fiadoLancamento.criadoEm))
    .limit(20);
  return NextResponse.json({ ok: true, lancamentos: linhas });
}

/** POST — a loja devolve o resultado de um lançamento (aplicado ou erro). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as
    | { f?: string; e?: number; s?: string; id?: string; ok?: boolean; erro?: string; codigo?: number; saldo?: number }
    | null;
  if (!body || !autoriza(String(body.f || ''), Number(body.e || 0), String(body.s || ''))) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(String(body.id || ''))) {
    return NextResponse.json({ ok: false, erro: 'id inválido' }, { status: 400 });
  }
  const { db, schema } = await import('@concilia/db');
  const { and, eq } = await import('drizzle-orm');
  await db
    .update(schema.fiadoLancamento)
    .set({
      status: body.ok ? 'aplicado' : 'erro',
      erro: body.ok ? null : String(body.erro || 'falhou na loja').slice(0, 400),
      codigoExterno: body.ok && body.codigo ? Number(body.codigo) : null,
      saldoDepois: body.ok && body.saldo != null ? String(body.saldo) : null,
      aplicadoEm: new Date(),
    })
    .where(and(eq(schema.fiadoLancamento.id, String(body.id)), eq(schema.fiadoLancamento.filialId, String(body.f))));
  return NextResponse.json({ ok: true });
}
