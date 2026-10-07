// POST /api/relatorios/historico-faturamento/lancamento — o que o dono digita
// na aba: total do mês das unidades sem PDV e os eventos/festas fora do PDV.
// Só responde com a aba aberta (passe da senha valendo).
//
// Body: { organizacaoId, acao, ... }
//   meses          — { unidadeId, ano, valores: [{ mes: 1..12, valor: number | null }] }
//                    (null apaga o lançamento do mês; 0 é número válido)
//   evento-novo    — { unidadeId, mes: 'YYYY-MM', valor, observacao? }
//   evento-excluir — { id }

import { NextResponse } from 'next/server';
import { db } from '@concilia/db';
import { hojeBr } from '@/lib/datas';
import { guardaAba } from '@/lib/faturamento-acesso-sessao';
import {
  chaveMes,
  criarEvento,
  ehUuid,
  excluirEvento,
  gravarTotal,
  mesValido,
  partesMes,
  pdvCobre,
  rotuloMes,
  unidadeDaOrg,
} from '@/lib/faturamento-historico';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** numeric(14,2) guarda até 999.999.999.999,99. */
const VALOR_MAX = 999_999_999_999;
const ANO_MIN = 2000;
const OBS_MAX = 200;

const erro = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return erro('corpo inválido');

  const g = await guardaAba(body.organizacaoId, true);
  if (g.error) return g.error;
  const { user, org } = g;
  const mesAtual = hojeBr().slice(0, 7);

  if (body.acao === 'evento-excluir') {
    const id = body.id;
    if (!ehUuid(id)) return erro('evento inválido');
    const apagou = await excluirEvento(id, org.id);
    return apagou ? NextResponse.json({ ok: true }) : erro('evento não encontrado', 404);
  }

  if (body.acao !== 'meses' && body.acao !== 'evento-novo') return erro('ação desconhecida');

  const unidadeId = body.unidadeId;
  if (!ehUuid(unidadeId)) return erro('unidade inválida');
  const unidade = await unidadeDaOrg(unidadeId);
  if (!unidade || unidade.organizacaoId !== org.id) return erro('unidade não encontrada', 404);

  if (body.acao === 'evento-novo') {
    const mesEvento = body.mes;
    if (!mesValido(mesEvento)) return erro('Escolha o mês do evento.');
    if (mesEvento > mesAtual) return erro('O mês do evento ainda não chegou.');
    const valor = body.valor;
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || valor > VALOR_MAX) {
      return erro('Informe o valor do evento (maior que zero).');
    }
    const observacao = typeof body.observacao === 'string' ? body.observacao.trim() : '';
    if (observacao.length > OBS_MAX) return erro(`A descrição passa de ${OBS_MAX} letras.`);
    const { ano, mes } = partesMes(mesEvento);
    const id = await criarEvento(unidade.id, ano, mes, valor, observacao || null, user.id);
    return NextResponse.json({ ok: true, id });
  }

  // acao === 'meses'
  const ano = body.ano;
  const anoAtual = Number(mesAtual.slice(0, 4));
  if (typeof ano !== 'number' || !Number.isInteger(ano) || ano < ANO_MIN || ano > anoAtual) {
    return erro('ano inválido');
  }
  if (!Array.isArray(body.valores) || body.valores.length === 0 || body.valores.length > 12) {
    return erro('nada pra gravar');
  }
  const gravar: Array<{ mes: number; valor: number | null }> = [];
  const vistos = new Set<number>();
  for (const bruto of body.valores as unknown[]) {
    const v = bruto as { mes?: unknown; valor?: unknown } | null;
    const mes = v?.mes;
    if (typeof mes !== 'number' || !Number.isInteger(mes) || mes < 1 || mes > 12 || vistos.has(mes)) {
      return erro('mês inválido');
    }
    vistos.add(mes);
    const chave = chaveMes(ano, mes);
    if (chave > mesAtual) return erro(`${rotuloMes(chave)} ainda não chegou.`);
    if (pdvCobre(unidade, chave, mesAtual)) {
      return erro(`${rotuloMes(chave)} de ${unidade.nome} vem do PDV — não se digita.`);
    }
    const valor = v?.valor;
    if (valor === null) {
      gravar.push({ mes, valor: null });
      continue;
    }
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor > VALOR_MAX) {
      return erro(`Valor inválido em ${rotuloMes(chave)}.`);
    }
    gravar.push({ mes, valor });
  }

  // Tudo ou nada: o ano digitado entra inteiro.
  await db.transaction(async (tx) => {
    for (const item of gravar) {
      await gravarTotal(unidade.id, ano, item.mes, item.valor, user.id, tx);
    }
  });
  return NextResponse.json({ ok: true, gravados: gravar.length });
}
