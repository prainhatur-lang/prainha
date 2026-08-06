// GET /api/cron/conciliacao-diaria
//
// Conciliação AUTOMÁTICA de todas as filiais: roda a cadeia inteira
// (Operadora → Recebíveis → Banco) + materializa a baixa por pagamento.
// Agendado DEPOIS das ingestões (cielo-edi e extrato-inter) no vercel.json —
// a ordem importa: conciliar antes de ingerir é conciliar contra dado velho.
//
// Janela de 7 dias: cobre arquivo atrasado da Cielo, crédito que só caiu
// hoje e reapresentação. Dias fechados são preservados pelas engines.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { rodarConciliacaoAutomatica } from '@/lib/conciliacao-automatica';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dataFim = hojeBr();
  const dataInicio = diasAtrasBr(7);

  const filiais = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome })
    .from(schema.filial);

  const resultados: Array<Record<string, unknown>> = [];
  for (const f of filiais) {
    try {
      const r = await rodarConciliacaoAutomatica({ filialId: f.id, dataInicio, dataFim });
      resultados.push({
        filial: f.nome,
        ok: true,
        operadora: r.operadora.resumo,
        recebiveis: r.recebiveis.resumo,
        banco: r.banco.resumo,
        baixa: r.baixa,
      });
    } catch (e) {
      // uma filial com erro não derruba as outras
      console.error('[conciliacao-diaria]', f.nome, (e as Error).message);
      resultados.push({ filial: f.nome, ok: false, erro: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, janela: { dataInicio, dataFim }, resultados });
}
