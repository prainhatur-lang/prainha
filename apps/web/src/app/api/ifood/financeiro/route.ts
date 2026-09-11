// Financeiro do iFood de UMA casa, com a conferência contra o Concilia.
//
//   GET  ?filialId=&visao=…&formato=csv
//     vendas        ?de&ate          pedido a pedido, casado com a conta a receber
//     repasses      ?de&ate&base     títulos de repasse (pagamento | calculo)
//     eventos       ?de&ate          taxas e ocorrências (janelas de 30 dias)
//     antecipacoes  ?de&ate&base     quanto custou receber antes (calculo | pagamento)
//     conciliacao   ?competencia     o arquivo do mês, somado e conferido contra
//                   [&requestId]     repasses, eventos e vendas; com requestId lê
//                                    o arquivo sob demanda em vez do mensal
//     sob-demanda   ?competencia     pedidos sob demanda das últimas 24 h, com o
//                                    status atualizado no iFood
//   POST { acao: 'gravar-liquido', filialId, de, ate }
//   POST { acao: 'pedir-conciliacao', filialId, competencia }
//
// A visão `vendas` é a do dia a dia: cada pedido do iFood ao lado do
// lançamento que nasceu dele no Concilia. Duas coisas aparecem aí e em nenhum
// outro lugar do sistema:
//
//   1. pedido do iFood SEM lançamento — o repasse vai cair no banco sem
//      contrapartida e o dinheiro sai do controle (era o buraco da integração
//      própria, ver api/loja/receber-canal);
//   2. lançamento com bruto diferente do bruto do iFood — em geral pedido
//      alterado depois de fechado.
//
// O casamento é SÓ por `pedido_ref` (= orderId do iFood). Tentar casar pelo
// número curto seria errado: nos lançamentos que vieram pelo Consumer o
// `pedido_numero` é o número do PEDIDOS do Consumer, não o displayId do iFood.
//
// Credencial: a do app do Financeiro (categoria Finanças) quando cadastrada —
// app PDV não tem o módulo Financial. Ver credFinanceiro.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { configIfood, credFinanceiro } from '@/lib/ifood-credenciais';
import { explicarErroIfood } from '@/lib/ifood-api';
import {
  vendasIfood, repassesIfood, eventosIfood, antecipacoesIfood, resumoVendas,
  arquivoConciliacaoMensal, baixarConciliacao, resumoConciliacao, csvConciliacao, csvDe,
  pedirConciliacaoSobDemanda, statusConciliacaoSobDemanda,
  diasEntre, somarDias, ultimoDiaDoMes, leituraCrua,
  type CredFin, type VendaIfood,
} from '@/lib/ifood-financeiro';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Conciliação baixa o arquivo e cruza com três leituras do iFood.
export const maxDuration = 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Teto do iFood por consulta em Sales, Settlements e Anticipations. */
const MAX_DIAS = 90;
/** O iFood aceita um pedido sob demanda por loja+competência a cada 6 h e o
 *  requestId vale 24 h. */
const JANELA_PEDIDO_MS = 6 * 3600 * 1000;
const VALIDADE_REQUEST_MS = 24 * 3600 * 1000;
/** Não consulta o status no iFood mais que isto (o polling da tela já espaça). */
const MIN_ENTRE_CONSULTAS_MS = 25 * 1000;

function periodo(sp: URLSearchParams): { de: string; ate: string } {
  const de = sp.get('de') ?? '';
  const ate = sp.get('ate') ?? '';
  return {
    de: YMD.test(de) ? de : diasAtrasBr(14),
    ate: YMD.test(ate) ? ate : hojeBr(),
  };
}

function competenciaDe(v: unknown): string {
  const s = String(v ?? '');
  return COMPETENCIA.test(s) ? s : hojeBr().slice(0, 7);
}

const erroJson = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

/** Credencial do Financeiro da casa + conferência de acesso do usuário. */
async function casa(userId: string, filialId: string) {
  const minhas = await filiaisDoUsuario(userId);
  const filial = minhas.find((f) => f.id === filialId);
  if (!filial) return { erro: erroJson('filial') };
  const cfg = await configIfood(filialId);
  const fin = credFinanceiro(cfg);
  if (!fin) {
    return {
      erro: erroJson(
        cfg.clientId || cfg.fin.clientId
          ? 'falta o merchant_id desta casa em Configurações → iFood'
          : 'esta casa não tem credencial do iFood — cadastre o app do Financeiro em Configurações → iFood',
      ),
    };
  }
  const c: CredFin = { clientId: fin.clientId, clientSecret: fin.clientSecret, homologacao: fin.homologacao };
  return { filial, c, merchantId: fin.merchantId, appProprio: fin.appProprio, homologacao: fin.homologacao };
}

/** Erro do iFood → recado claro por status (critério da homologação). */
function falha(e: unknown) {
  const x = explicarErroIfood(e, 'Financeiro');
  // O recado de tela resume; o bruto fica no log da Vercel pra diagnóstico.
  console.error('[ifood/financeiro]', x.status, String((e as Error)?.message ?? e).slice(0, 500));
  return NextResponse.json({ error: x.mensagem, semModulo: x.semModulo, codigo: x.codigo }, { status: x.status });
}

function csvResposta(nome: string, corpo: string) {
  return new NextResponse(corpo, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${nome.replace(/[^\w.-]+/g, '-')}"`,
      'cache-control': 'no-store',
    },
  });
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('conta_receber.read');
  if (error) return error;

  const sp = new URL(request.url).searchParams;
  const filialId = sp.get('filialId') ?? '';
  const k = await casa(user.id, filialId);
  if (k.erro) return k.erro;
  const { filial, c, merchantId } = k;

  const visao = sp.get('visao') ?? 'vendas';
  const csv = sp.get('formato') === 'csv';
  const { de, ate } = periodo(sp);
  const base = {
    filial: { id: filial.id, nome: filial.nome },
    de, ate, visao,
    appProprio: k.appProprio,
    homologacao: k.homologacao,
    lidoEm: new Date().toISOString(),
  };
  const arquivo = (nome: string) => `ifood-${nome}-${slug(filial.nome)}-${de}_${ate}.csv`;

  if (['vendas', 'repasses', 'antecipacoes'].includes(visao)) {
    if (de > ate) return erroJson('a data inicial é depois da final');
    if (diasEntre(de, ate) > MAX_DIAS - 1) {
      return erroJson(`o iFood entrega no máximo ${MAX_DIAS} dias por consulta — aperte o período`);
    }
  }

  try {
    if (visao === 'repasses') {
      const b = sp.get('base') === 'calculo' ? 'calculo' : 'pagamento';
      const r = await repassesIfood(c, merchantId, de, ate, b);
      if (csv) {
        return csvResposta(arquivo('repasses'), csvDe(
          ['pagamento', 'calculo_de', 'calculo_ate', 'titulo', 'tipo', 'produto', 'valor', 'situacao', 'transacao', 'banco', 'agencia', 'conta', 'documento'],
          r.itens.map((i) => [i.pagoEm, i.calculoDe, i.calculoAte, i.id, i.tipo, i.produto, i.valor, i.situacao, i.transacaoId, i.banco, i.agencia, i.conta, i.documento]),
        ));
      }
      return NextResponse.json({ ...base, base: b, ...r });
    }

    if (visao === 'eventos') {
      if (de > ate) return erroJson('a data inicial é depois da final');
      if (diasEntre(de, ate) > 366) return erroJson('período grande demais pra eventos — use no máximo um ano');
      const r = await eventosIfood(c, merchantId, de, ate, csv ? 40 : 10);
      if (csv) {
        return csvResposta(arquivo('eventos'), csvDe(
          ['data_hora', 'competencia', 'nome', 'descricao', 'produto', 'gatilho', 'referencia_tipo', 'referencia_id', 'impacto_no_repasse', 'valor', 'base_calculo', 'percentual', 'repasse_previsto', 'metodo', 'bandeira', 'responsavel_pagamento', 'recebedor'],
          r.eventos.map((e) => [e.quando, e.competencia, e.nome, e.descricao, e.produto, e.gatilho, e.refTipo, e.refId, e.mexeNoRepasse, e.valor, e.baseCalculo, e.percentual, e.repasseEm, e.metodo, e.bandeira, e.responsavel, e.recebedor]),
        ));
      }
      const soma = (f: (x: (typeof r.eventos)[number]) => boolean) =>
        Number(r.eventos.filter(f).reduce((a, e) => a + e.valor, 0).toFixed(2));
      return NextResponse.json({
        ...base,
        ...r,
        comImpacto: soma((e) => e.mexeNoRepasse),
        informativo: soma((e) => !e.mexeNoRepasse),
      });
    }

    if (visao === 'antecipacoes') {
      const b = sp.get('base') === 'pagamento' ? 'pagamento' : 'calculo';
      const r = await antecipacoesIfood(c, merchantId, de, ate, b);
      if (csv) {
        return csvResposta(arquivo('antecipacoes'), csvDe(
          ['calculo_de', 'calculo_ate', 'tipo', 'valor_original', 'taxa_percentual', 'taxa_valor', 'valor_antecipado', 'situacao', 'data_original', 'data_antecipada', 'dias_antes', 'banco', 'agencia', 'conta', 'documento'],
          r.itens.map((i) => [i.calculoDe, i.calculoAte, i.tipo, i.valorOriginal, i.taxaPercentual, i.taxaValor, i.valorAntecipado, i.situacao, i.dataOriginal, i.dataAntecipada, String(i.diasAntes), i.banco, i.agencia, i.conta, i.documento]),
        ));
      }
      const ok = r.itens.filter((i) => /SUCC/i.test(i.situacao));
      const soma = (f: (i: (typeof ok)[number]) => number) => Number(ok.reduce((a, i) => a + f(i), 0).toFixed(2));
      const original = soma((i) => i.valorOriginal);
      const taxa = soma((i) => i.taxaValor);
      return NextResponse.json({
        ...base,
        base: b,
        ...r,
        totais: {
          original,
          taxa,
          antecipado: soma((i) => i.valorAntecipado),
          taxaMedia: original ? Number(((100 * taxa) / original).toFixed(2)) : 0,
          diasMedios: ok.length ? Math.round(ok.reduce((a, i) => a + i.diasAntes, 0) / ok.length) : 0,
          falhas: r.itens.length - ok.length,
        },
      });
    }

    if (visao === 'sob-demanda') {
      const competencia = competenciaDe(sp.get('competencia'));
      return NextResponse.json({ ...base, competencia, pedidos: await pedidosSobDemanda(filialId, merchantId, competencia, c) });
    }

    if (visao === 'conciliacao') return await conciliacao(sp, base, filialId, merchantId, c, csv, filial.nome);

    if (visao === 'cru') {
      // Resposta crua do iFood, só GET: conferir contrato e anexar log na homologação.
      const recurso = sp.get('recurso');
      if (recurso !== 'sales' && recurso !== 'financial-events' && recurso !== 'settlements' && recurso !== 'anticipations') {
        return erroJson('recurso: sales, financial-events, settlements ou anticipations');
      }
      const params: Record<string, string> = {};
      for (const [k2, v] of sp) {
        if (!['filialId', 'visao', 'recurso', 'formato', 'de', 'ate'].includes(k2) && /^[A-Za-z]{1,40}$/.test(k2)) params[k2] = v.slice(0, 40);
      }
      return NextResponse.json({ ...base, ...(await leituraCrua(c, merchantId, recurso, params)) });
    }

    // ─── vendas ───
    const { vendas, total, recebidas, incompleto } = await vendasIfood(c, merchantId, de, ate);
    const linhas = await casarComConcilia(filialId, vendas);
    if (csv) {
      return csvResposta(arquivo('vendas'), csvDe(
        ['pedido', 'pedido_curto', 'data_hora', 'status', 'canal', 'pagamento', 'metodo', 'bandeira', 'responsavel', 'bruto', 'itens', 'taxa_entrega', 'taxa_servico', 'promo_loja', 'promo_ifood', 'comissao', 'comissao_entrega', 'taxa_cartao', 'taxa_antecipacao', 'outras', 'liquido', 'lancamento_concilia', 'bruto_concilia', 'problema'],
        linhas.map((v) => [v.orderId, v.displayId, v.dataHora, v.status, v.canal, v.tipoPagamento, v.metodo, v.bandeira, v.responsavel, v.bruto, v.itens, v.taxaEntrega, v.taxaServico, v.promoLoja, v.promoIfood, v.comissao, v.comissaoEntrega, v.taxaCartao, v.taxaAntecipacao, v.outras, v.liquido, v.lancamento, v.brutoConcilia, v.problema]),
      ));
    }
    return NextResponse.json({
      ...base,
      total,
      recebidas,
      incompleto,
      resumo: resumoVendas(vendas),
      comProblema: linhas.filter((l) => l.problema).length,
      semLiquidoGravado: linhas.filter((l) => l.lancamentoId && l.liquidoGravado == null).length,
      vendas: linhas,
    });
  } catch (e) {
    return falha(e);
  }
}

async function casarComConcilia(filialId: string, vendas: VendaIfood[]) {
  const refs = vendas.map((v) => v.orderId).filter(Boolean);
  const lancs = refs.length
    ? await db
        .select({
          id: schema.contaReceberCanal.id,
          pedidoRef: schema.contaReceberCanal.pedidoRef,
          status: schema.contaReceberCanal.status,
          valorBruto: schema.contaReceberCanal.valorBruto,
          valorLiquidoEsperado: schema.contaReceberCanal.valorLiquidoEsperado,
        })
        .from(schema.contaReceberCanal)
        .where(and(
          eq(schema.contaReceberCanal.filialId, filialId),
          inArray(schema.contaReceberCanal.pedidoRef, refs),
        ))
    : [];
  const porRef = new Map(lancs.map((l) => [String(l.pedidoRef), l]));

  return vendas.map((v) => {
    const l = porRef.get(v.orderId);
    // Pagamento na entrega não gera conta a receber de canal (o dinheiro
    // entrou no caixa da casa), então ausência ali não é problema.
    const naEntrega = v.tipoPagamento === 'OFFLINE';
    const cancelada = /CANCEL/i.test(v.status);
    const bruto = l ? Number(l.valorBruto) : 0;
    const difere = !!l && Math.abs(bruto - v.bruto) > 0.01;
    return {
      ...v,
      lancamento: l ? l.status : naEntrega ? 'na entrega' : 'sem lançamento',
      lancamentoId: l?.id ?? null,
      brutoConcilia: l ? bruto : null,
      liquidoGravado: l?.valorLiquidoEsperado == null ? null : Number(l.valorLiquidoEsperado),
      problema: !l && !naEntrega && !cancelada
        ? 'pedido do iFood sem conta a receber no Concilia'
        : difere
          ? 'bruto do Concilia difere do bruto do iFood'
          : '',
    };
  });
}

/** O mês fechado. Soma o arquivo (regra do iFood: líquido = soma de `valor`
 *  onde `impacto_no_repasse = SIM`) e confere de três lados — cada conferência
 *  falha sozinha sem derrubar a leitura do arquivo:
 *
 *    títulos  cada id_saldo contra o título de repasse (settlements);
 *    eventos  soma com impacto do CSV = soma dos eventos com hasTransferImpact;
 *    vendas   toda venda concluída do mês aparece na conciliação (reprovação
 *             comum na homologação: "Sales sem Reconciliation"). */
async function conciliacao(
  sp: URLSearchParams,
  base: Record<string, unknown>,
  filialId: string,
  merchantId: string,
  c: CredFin,
  csv: boolean,
  nomeFilial: string,
) {
  const competencia = competenciaDe(sp.get('competencia'));
  const requestId = sp.get('requestId') ?? '';

  let url: string;
  let criadoEm = '';
  let sha256 = '';
  let linhasEsperadas: number | null = null;
  if (requestId) {
    const pedido = await db
      .select({ id: schema.ifoodConciliacaoPedido.id })
      .from(schema.ifoodConciliacaoPedido)
      .where(and(
        eq(schema.ifoodConciliacaoPedido.filialId, filialId),
        eq(schema.ifoodConciliacaoPedido.requestId, requestId),
      ))
      .limit(1);
    if (!pedido.length) return erroJson('pedido sob demanda desconhecido nesta casa', 404);
    const st = await statusConciliacaoSobDemanda(c, merchantId, requestId);
    await atualizarPedido(filialId, requestId, st.status, st.fase, st.erro);
    if (st.fase !== 'pronto') {
      return erroJson(st.fase === 'processando' ? 'o arquivo sob demanda ainda está sendo gerado' : st.erro, 409, { fase: st.fase });
    }
    url = st.url;
  } else {
    const m = await arquivoConciliacaoMensal(c, merchantId, competencia);
    url = m.url;
    criadoEm = m.criadoEm;
    sha256 = m.sha256;
    linhasEsperadas = m.linhasEsperadas;
  }

  const { linhas, sha256Confere } = await baixarConciliacao(url, sha256);
  if (csv) {
    return csvResposta(`ifood-conciliacao-${slug(nomeFilial)}-${competencia}${requestId ? '-sob-demanda' : ''}.csv`, csvConciliacao(linhas));
  }
  const resumo = resumoConciliacao(linhas);
  const ini = competencia + '-01';
  const fim = ultimoDiaDoMes(competencia);
  const tolerancia = Math.max(0.01, Math.abs(resumo.liquido) * 0.0001);
  const msg = (e: unknown) => explicarErroIfood(e, 'Financeiro').mensagem;

  const [titulos, eventos, vendas] = await Promise.allSettled([
    // Semana de cálculo pode atravessar a virada do mês.
    repassesIfood(c, merchantId, somarDias(ini, -7), somarDias(fim, 7), 'calculo'),
    eventosIfood(c, merchantId, ini, fim, 10),
    vendasIfood(c, merchantId, ini, fim, 20),
  ]);

  const saldos = resumo.saldos.map((s) => {
    const t = titulos.status === 'fulfilled' ? titulos.value.itens.find((i) => i.id === s.idSaldo) : undefined;
    return {
      ...s,
      titulo: t ? { valor: t.valor, situacao: t.situacao, pagoEm: t.pagoEm, tipo: t.tipo, banco: t.banco, conta: t.conta } : null,
    };
  });

  let confEventos: Record<string, unknown>;
  if (eventos.status === 'fulfilled') {
    const soma = Number(eventos.value.eventos.filter((e) => e.mexeNoRepasse).reduce((a, e) => a + e.valor, 0).toFixed(2));
    const diferenca = Number((resumo.liquido - soma).toFixed(2));
    confEventos = { soma, diferenca, confere: Math.abs(diferenca) <= tolerancia, incompleto: eventos.value.temMais };
  } else {
    confEventos = { erro: msg(eventos.reason) };
  }

  let confVendas: Record<string, unknown>;
  if (vendas.status === 'fulfilled') {
    const pedidos = new Set(linhas.map((l) => l.pedido).filter(Boolean));
    const concluidas = vendas.value.vendas.filter((v) => !/CANCEL/i.test(v.status));
    const fora = concluidas.filter((v) => !pedidos.has(v.orderId));
    confVendas = {
      vendas: concluidas.length,
      naConciliacao: concluidas.length - fora.length,
      fora: fora.slice(0, 50).map((v) => ({ orderId: v.orderId, displayId: v.displayId, data: v.data, bruto: v.bruto, status: v.status })),
      qtdFora: fora.length,
      incompleto: vendas.value.incompleto,
    };
  } else {
    confVendas = { erro: msg(vendas.reason) };
  }

  return NextResponse.json({
    ...base,
    competencia,
    origem: requestId ? 'sob-demanda' : 'mensal',
    requestId: requestId || null,
    arquivoCriadoEm: criadoEm,
    linhasEsperadas,
    sha256Confere,
    resumo: { ...resumo, saldos },
    conferencia: {
      tolerancia,
      titulos: titulos.status === 'fulfilled'
        ? { encontrados: saldos.filter((s) => s.titulo).length, total: saldos.length, divergentes: saldos.filter((s) => s.titulo && s.confere === false).length }
        : { erro: msg(titulos.reason) },
      eventos: confEventos,
      vendas: confVendas,
    },
  });
}

async function atualizarPedido(filialId: string, requestId: string, status: string, fase: string, erro: string) {
  await db
    .update(schema.ifoodConciliacaoPedido)
    .set({
      status: status.slice(0, 30),
      fase,
      erro: erro || null,
      atualizadoEm: new Date(),
      ...(fase === 'pronto' ? { prontoEm: new Date() } : {}),
    })
    .where(and(
      eq(schema.ifoodConciliacaoPedido.filialId, filialId),
      eq(schema.ifoodConciliacaoPedido.requestId, requestId),
    ));
}

/** Pedidos das últimas 24 h (o requestId não vale mais que isso). O que está
 *  processando tem o status consultado no iFood — no máximo a cada 25 s. */
async function pedidosSobDemanda(filialId: string, merchantId: string, competencia: string, c: CredFin) {
  const t = schema.ifoodConciliacaoPedido;
  const lidos = await db
    .select()
    .from(t)
    .where(and(
      eq(t.filialId, filialId),
      eq(t.merchantId, merchantId),
      eq(t.competencia, competencia),
      gte(t.pedidoEm, new Date(Date.now() - VALIDADE_REQUEST_MS)),
    ))
    .orderBy(desc(t.pedidoEm))
    .limit(10);

  const agora = Date.now();
  for (const p of lidos) {
    if (p.fase !== 'processando' || agora - p.atualizadoEm.getTime() < MIN_ENTRE_CONSULTAS_MS) continue;
    const st = await statusConciliacaoSobDemanda(c, merchantId, p.requestId);
    await atualizarPedido(filialId, p.requestId, st.status, st.fase, st.erro);
    Object.assign(p, { status: st.status, fase: st.fase, erro: st.erro || null, atualizadoEm: new Date() });
  }
  return lidos.map((p) => ({
    requestId: p.requestId,
    status: p.status,
    fase: p.fase,
    erro: p.erro,
    pedidoEm: p.pedidoEm.toISOString(),
    atualizadoEm: p.atualizadoEm.toISOString(),
    prontoEm: p.prontoEm?.toISOString() ?? null,
  }));
}

export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => ({}))) as {
    acao?: string; filialId?: string; de?: string; ate?: string; competencia?: string;
  };
  if (corpo.acao === 'pedir-conciliacao') return pedirConciliacao(corpo);
  return gravarLiquido(corpo);
}

/** Pede o arquivo sob demanda. Reaproveita antes de pedir: um pedido desta
 *  competência nas últimas 6 h (o iFood devolveria 409) ou, se o iFood
 *  responder 409 mesmo assim, o último requestId ainda válido. */
async function pedirConciliacao(corpo: { filialId?: string; competencia?: string }) {
  const { user, error } = await exigirPermApi('conta_receber.read');
  if (error) return error;
  const filialId = String(corpo.filialId ?? '');
  const k = await casa(user.id, filialId);
  if (k.erro) return k.erro;
  const competencia = String(corpo.competencia ?? '');
  if (!COMPETENCIA.test(competencia)) return erroJson('competência inválida (use aaaa-mm)');
  if (competencia > hojeBr().slice(0, 7)) return erroJson('não dá pra conciliar um mês que ainda não começou');

  const t = schema.ifoodConciliacaoPedido;
  const recentes = await db
    .select({ requestId: t.requestId, fase: t.fase, pedidoEm: t.pedidoEm })
    .from(t)
    .where(and(
      eq(t.filialId, filialId),
      eq(t.merchantId, k.merchantId),
      eq(t.competencia, competencia),
      gte(t.pedidoEm, new Date(Date.now() - VALIDADE_REQUEST_MS)),
    ))
    .orderBy(desc(t.pedidoEm))
    .limit(5);
  const reusavel = recentes.find(
    (p) => Date.now() - p.pedidoEm.getTime() < JANELA_PEDIDO_MS && (p.fase === 'processando' || p.fase === 'pronto'),
  );
  if (reusavel) return NextResponse.json({ ok: true, requestId: reusavel.requestId, reaproveitado: true });

  try {
    const r = await pedirConciliacaoSobDemanda(k.c, k.merchantId, competencia);
    if (r.conflito) {
      const valido = recentes.find((p) => p.fase !== 'expirado');
      if (valido) return NextResponse.json({ ok: true, requestId: valido.requestId, reaproveitado: true });
      if (r.requestId) {
        // O iFood contou qual é o pedido vigente: passa a acompanhar ele.
        await db.insert(t).values({ filialId, merchantId: k.merchantId, competencia, requestId: r.requestId, pedidoPor: user.id }).onConflictDoNothing();
        return NextResponse.json({ ok: true, requestId: r.requestId, reaproveitado: true });
      }
      return erroJson(
        'o iFood já tem um pedido recente desta competência que o Concilia não registrou, e só aceita outro depois de 6 h',
        409,
      );
    }
    await db.insert(t).values({
      filialId,
      merchantId: k.merchantId,
      competencia,
      requestId: r.requestId,
      pedidoPor: user.id,
    });
    return NextResponse.json({ ok: true, requestId: r.requestId, reaproveitado: false });
  } catch (e) {
    return falha(e);
  }
}

/** Grava nos lançamentos abertos o líquido que o iFood diz que vai repassar.
 *  Só mexe em `aberto`: baixado/cancelado é trabalho de gente e não se
 *  sobrescreve (mesma regra do /api/loja/receber-canal). */
async function gravarLiquido(corpo: { filialId?: string; de?: string; ate?: string }) {
  const { user, error } = await exigirPermApi('conta_receber.update');
  if (error) return error;

  const filialId = String(corpo.filialId ?? '');
  const k = await casa(user.id, filialId);
  if (k.erro) return k.erro;

  const sp = new URLSearchParams({ de: String(corpo.de ?? ''), ate: String(corpo.ate ?? '') });
  const { de, ate } = periodo(sp);
  if (de > ate || diasEntre(de, ate) > MAX_DIAS - 1) return erroJson(`período inválido (máximo ${MAX_DIAS} dias)`);

  try {
    const { vendas } = await vendasIfood(k.c, k.merchantId, de, ate);
    let gravados = 0;
    for (const v of vendas) {
      if (!v.orderId || v.tipoPagamento === 'OFFLINE' || /CANCEL/i.test(v.status)) continue;
      const r = await db
        .update(schema.contaReceberCanal)
        .set({ valorLiquidoEsperado: v.liquido.toFixed(2), atualizadoEm: new Date() })
        .where(and(
          eq(schema.contaReceberCanal.filialId, filialId),
          eq(schema.contaReceberCanal.pedidoRef, v.orderId),
          eq(schema.contaReceberCanal.status, 'aberto'),
        ))
        .returning({ id: schema.contaReceberCanal.id });
      gravados += r.length;
    }
    return NextResponse.json({ ok: true, gravados, pedidos: vendas.length });
  } catch (e) {
    return falha(e);
  }
}
