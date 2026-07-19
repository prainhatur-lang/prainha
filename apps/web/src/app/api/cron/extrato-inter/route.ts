// GET /api/cron/extrato-inter
// Cron diário que busca o extrato da API do Inter (sem depender de upload
// manual de CNAB) e grava em lancamento_banco. Janela de 10 dias (rolling,
// com overlap de propósito) — cobre lançamentos que "atrasaram" pra aparecer
// no extrato e a dedupe (unique constraint) cuida do resto.
//
// Roda pra toda conta configurada em contasConfiguradas() (uma por filial —
// mesmo CNPJ raiz não implica mesma conta bancária, ver lib/inter.ts).
//
// Depois de atualizar o extrato, já roda a conciliação Banco (cruza
// Recebíveis Cielo x lancamento_banco) na mesma janela — o usuário só
// confere as exceções em /conciliacao/banco, não precisa clicar em "Rodar
// conciliação" toda vez.

import { NextResponse } from 'next/server';
import { processarExtratoInterApi } from '@/lib/processadores';
import { contasConfiguradas } from '@/lib/inter';
import { rodarConciliacaoBanco } from '@/lib/conciliacao-banco';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const contas = contasConfiguradas();
  const fim = hojeBr();
  const inicio = diasAtrasBr(10);

  const resultados = [];
  for (const { filialId, cred } of contas) {
    let extrato;
    try {
      extrato = { ok: true as const, resumo: await processarExtratoInterApi(filialId, inicio, fim, cred) };
    } catch (e) {
      extrato = { ok: false as const, erro: (e as Error).message };
    }

    let conciliacao;
    try {
      conciliacao = { ok: true as const, resumo: await rodarConciliacaoBanco({ filialId, dataInicio: inicio, dataFim: fim }) };
    } catch (e) {
      conciliacao = { ok: false as const, erro: (e as Error).message };
    }

    resultados.push({ filialId, extrato, conciliacao });
  }

  return NextResponse.json({ ok: true, executadoEm: new Date().toISOString(), resultados });
}
