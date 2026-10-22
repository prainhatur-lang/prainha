// GET /api/cron/certificado-loja
// De hora em hora: emite/renova o *.loja.prainhabar.com (Let's Encrypt) que o
// vendas-local das casas usa no https. Só trabalha quando falta < 30 dias ou
// ainda não existe; depois de erro espera 6 h. Ver lib/certificado-loja.ts.
// Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { renovarSePreciso } from '@/lib/certificado-loja';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!process.env.DESEC_TOKEN || !process.env.DESEC_DOMINIO) {
    return NextResponse.json({ ok: true, feito: false, motivo: 'DESEC_TOKEN/DESEC_DOMINIO ainda não configurados' });
  }
  const forcar = new URL(req.url).searchParams.get('forcar') === '1';
  const r = await renovarSePreciso(forcar);
  return NextResponse.json({ ok: true, ...r });
}
