// POST /api/extratos-fechamento/inter — botão "Buscar no Inter" do Fechamento
// do mês: busca o extrato do mês na API do banco e guarda a planilha na conta.
// Corpo: { ano, mes, contaId? } — sem contaId, vale pra todas as contas Inter
// que o usuário enxerga. É o mesmo que o cron do dia 1 faz sozinho
// (/api/cron/extrato-fechamento-inter); aqui serve pra mês antigo ou pra não
// esperar o cron.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { hojeBr } from '@/lib/datas';
import { PERM_EXTRATO_ENVIAR, contasExtratoVisiveis, periodoExtratoValido } from '@/lib/extratos-fechamento';
import { guardarExtratosInterDoMes, mesJaEncerrou } from '@/lib/extrato-inter-fechamento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await exigirPermApi(PERM_EXTRATO_ENVIAR);
  if (auth.error) return auth.error;

  const body = (await req.json().catch(() => null)) as { ano?: number; mes?: number; contaId?: string } | null;
  const ano = Number(body?.ano);
  const mes = Number(body?.mes);
  const contaId = body?.contaId ? String(body.contaId) : '';
  if (!periodoExtratoValido(ano, mes)) return NextResponse.json({ error: 'mês inválido' }, { status: 400 });
  if (!mesJaEncerrou(ano, mes, hojeBr())) {
    return NextResponse.json({ error: 'o mês ainda não fechou — o extrato completo só existe depois' }, { status: 400 });
  }

  const visiveis = await contasExtratoVisiveis(auth.user.id);
  // Sem contaId, só as contas pedidas; com contaId, vale também a que está em "não pedir mais".
  const contaIds = visiveis.filter((c) => (contaId ? c.id === contaId : c.ativo)).map((c) => c.id);
  if (contaId && contaIds.length === 0) return NextResponse.json({ error: 'conta não encontrada' }, { status: 404 });

  const resultados = await guardarExtratosInterDoMes({ ano, mes, contaIds, enviadoPor: auth.user.id });
  if (contaId) {
    const r = resultados[0];
    if (!r) return NextResponse.json({ error: 'essa conta não é do Inter' }, { status: 400 });
    if (r.situacao === 'sem_integracao') {
      return NextResponse.json({ error: `${r.titular}: ${r.detalhe} — envie o arquivo do banco` }, { status: 409 });
    }
    if (r.situacao === 'erro') return NextResponse.json({ error: `o Inter não respondeu: ${r.detalhe}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true, resultados });
}
