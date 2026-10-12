// GET /api/cron/extrato-fechamento-inter
// Virou o mês: busca na API do Inter o extrato do mês que acabou, de cada conta
// "Inter" da lista do Fechamento do mês que tem integração, e guarda a planilha
// em /relatorios/fechamento — sem ninguém enviar arquivo.
//
// Roda nos dias 1, 2 e 5: o dia 1 já traz o mês; os outros dois pegam
// lançamento que o banco postou com data do mês anterior depois da virada.
// Repetir não duplica (ver lib/extrato-inter-fechamento).
//
// ?ano=AAAA&mes=M força outro mês (já encerrado).

import { NextResponse } from 'next/server';
import { hojeBr } from '@/lib/datas';
import { periodoExtratoValido } from '@/lib/extratos-fechamento';
import { guardarExtratosInterDoMes, mesAnterior, mesJaEncerrou } from '@/lib/extrato-inter-fechamento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const hoje = hojeBr();
  const url = new URL(req.url);
  let { ano, mes } = mesAnterior(hoje);
  if (url.searchParams.get('ano') && url.searchParams.get('mes')) {
    ano = Number(url.searchParams.get('ano'));
    mes = Number(url.searchParams.get('mes'));
  }
  if (!periodoExtratoValido(ano, mes) || !mesJaEncerrou(ano, mes, hoje)) {
    return NextResponse.json({ error: 'mês inválido ou ainda em andamento' }, { status: 400 });
  }

  const resultados = await guardarExtratosInterDoMes({ ano, mes });
  return NextResponse.json({ ok: true, ano, mes, resultados });
}
