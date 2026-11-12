// GET /api/cron/pix-sicredi
// A cada 30 min lê os Pix recebidos na Sicredi pela API Pix de cada casa
// configurada (lib/sicredi-pix.ts) e grava em lancamento_banco (conta 748).
// Janela de 3 dias com sobra: a dedupe (unique) cuida do repetido.
// Sem credencial em nenhuma casa, não faz nada. Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { contasSicredi, processarPixSicrediApi } from '@/lib/sicredi-pix';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const contas = await contasSicredi();
  if (contas.length === 0) return NextResponse.json({ ok: true, contas: 0, msg: 'nenhuma casa com API Pix Sicredi' });

  const fim = new Date();
  const inicio = new Date(fim.getTime() - 3 * 24 * 3600 * 1000);
  const resultados = [];
  for (const c of contas) {
    try {
      resultados.push({ casa: c.nome, ok: true, ...(await processarPixSicrediApi(c, inicio, fim)) });
    } catch (e) {
      resultados.push({ casa: c.nome, ok: false, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: resultados.every((r) => r.ok), resultados });
}
