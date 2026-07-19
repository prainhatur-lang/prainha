// GET /api/cron/extrato-inter
// Cron diário que busca o extrato da API do Inter (sem depender de upload
// manual de CNAB) e grava em lancamento_banco. Janela de 10 dias (rolling,
// com overlap de propósito) — cobre lançamentos que "atrasaram" pra aparecer
// no extrato e a dedupe (unique constraint) cuida do resto.
//
// v1: uma conta só (Prainha Bar), credenciais globais via env INTER_*.

import { NextResponse } from 'next/server';
import { processarExtratoInterApi } from '@/lib/processadores';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const filialId = process.env.INTER_FILIAL_ID;
  if (!filialId) {
    return NextResponse.json({ ok: true, skip: 'INTER_FILIAL_ID não configurado' });
  }

  const fim = hojeBr();
  const inicio = diasAtrasBr(10);

  try {
    const resumo = await processarExtratoInterApi(filialId, inicio, fim);
    return NextResponse.json({ ok: true, executadoEm: new Date().toISOString(), resumo });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 502 });
  }
}
