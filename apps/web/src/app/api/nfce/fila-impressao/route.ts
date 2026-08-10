// Fila de impressão de DANFE da loja (chamada pelo vendas-local, HMAC):
//   GET  ?f=&e=&s=          → jobs pendentes com os blocos de 48 col prontos
//   POST { f, e, s, ids }   → confirma que imprimiu (marca IMPRESSA)
// Assinatura: HMAC [f, 'fila', e] com PAGAR_MESA_SECRET (mesma do resto).

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { dadosDanfeDaNota } from '@/lib/nfce/emitir';
import { montarDanfeBlocos } from '@/lib/nfce/danfe';

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

function valida(f: string, e: number, s: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(f) && e * 1000 >= Date.now() - 1000 && confere([f, 'fila', String(e)], s);
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const f = sp.get('f') || '';
  const e = Number(sp.get('e') || 0);
  if (!valida(f, e, sp.get('s') || '')) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }

  // só jobs das últimas 24h — impressora quebrada não vira pilha de papel velho
  const corte = new Date(Date.now() - 24 * 3600e3);
  const jobs = await db
    .select()
    .from(schema.nfceReimpressao)
    .where(
      and(
        eq(schema.nfceReimpressao.filialId, f),
        eq(schema.nfceReimpressao.status, 'PENDENTE'),
        gte(schema.nfceReimpressao.criadoEm, corte),
      ),
    )
    .limit(5);
  if (jobs.length === 0) return NextResponse.json({ ok: true, jobs: [] });

  const [fil] = await db
    .select({ cnpj: schema.filial.cnpj, cfg: schema.filial.fiscalConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, f))
    .limit(1);
  if (!fil?.cfg?.endereco) return NextResponse.json({ ok: true, jobs: [] });

  const notas = await db
    .select()
    .from(schema.nfceEmitida)
    .where(inArray(schema.nfceEmitida.id, jobs.map((j) => j.nfceId)));
  const porId = new Map(notas.map((n) => [n.id, n]));

  return NextResponse.json({
    ok: true,
    jobs: jobs
      .map((j) => {
        const n = porId.get(j.nfceId);
        if (!n || n.status !== 'AUTORIZADA') return null;
        return {
          id: j.id,
          rotulo: `NFC-e ${n.numero}/${n.serie} ${n.mesa ?? ''}`.trim(),
          blocos: montarDanfeBlocos(dadosDanfeDaNota(n, fil.cfg!, fil.cnpj), 48),
        };
      })
      .filter(Boolean),
  });
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as
    | { f?: string; e?: number; s?: string; ids?: string[] }
    | null;
  if (!b || !valida(String(b.f || ''), Number(b.e || 0), String(b.s || ''))) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  const ids = (b.ids ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20);
  if (ids.length) {
    await db
      .update(schema.nfceReimpressao)
      .set({ status: 'IMPRESSA', impressoEm: new Date() })
      .where(
        and(
          eq(schema.nfceReimpressao.filialId, String(b.f)),
          inArray(schema.nfceReimpressao.id, ids),
        ),
      );
  }
  return NextResponse.json({ ok: true });
}
