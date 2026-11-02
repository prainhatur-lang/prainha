// Resultado do mês pro DONO (02/11/2026: "não recebi o relatório mensal… dia 01,
// o mês anterior com todas as vendas"). O mensal de 18/10 só ia pros destinos
// por casa (Lula/Lidiane); quem recebe o relatório completo (`telefones`) não
// recebia nada no dia 01.
//
// Dia 01, 07:00: o aviso do modelo `relatorio_diario` com as 3 casas e o total
// (com os 10%). O toque em "Ver resumo" (payload `mensal:<YYYY-MM-01>`) traz o
// mês inteiro de cada casa: faturamento com e sem os 10%, contas, ticket, dias,
// melhor dia, períodos, formas de pagamento, descontos e os mais vendidos.
//
// Conta direto no banco pela janela do mês operacional (dia 01 05:00 → dia 01
// do mês seguinte 05:00) — mesma regra do relatório diário, somada — pra
// responder o toque dentro do tempo do webhook. Registro com canal 'mensal'
// e dia = 1º do mês: sai uma vez por mês e pessoa. O mensal por casa
// (relatorio-casa-envio) continua igual.

import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { enviarTexto } from '@/lib/atendimento/zap';
import { eventosDoDia, reais, rotuloDia, somaDias, ultimoDiaFechado, ticketsDeEvento } from './relatorio-diario';
import { enviarModelo, janelaAberta, lerConfig, registrar, type OrigemEnvio, type PedidoRelatorio } from './relatorio-diario-envio';
import { rotuloMes } from './relatorio-casa-envio';

const TZ = 'America/Sao_Paulo';

/** 1º dia do mês anterior ao de `dia` (YYYY-MM-DD). */
export function mesAnteriorDe(dia: string): string {
  const a = Number(dia.slice(0, 4));
  const m = Number(dia.slice(5, 7));
  return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`;
}

function proximoMes(primeiroDia: string): string {
  const a = Number(primeiroDia.slice(0, 4));
  const m = Number(primeiroDia.slice(5, 7));
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
}

async function q<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const fmtN = (x: number) => Math.round(x).toLocaleString('pt-BR');

// Mesmos períodos do relatório diário (hora de abertura da conta).
const PERIODOS: Array<{ nome: string; horas: number[] }> = [
  { nome: 'Manhã', horas: [5, 6, 7, 8, 9, 10] },
  { nome: 'Almoço', horas: [11, 12, 13, 14] },
  { nome: 'Tarde', horas: [15, 16, 17] },
  { nome: 'Noite', horas: [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4] },
];

export interface MesCasa {
  filialId: string;
  nome: string;
  contas: number;
  /** PDV + tickets de evento, com os 10% */
  total: number;
  servico: number;
  desconto: number;
  eventos: number;
  ticket: number;
  dias: number;
  melhor: { dia: string; valor: number } | null;
  periodos: Array<{ nome: string; contas: number; valor: number }>;
  pagamentos: Array<{ forma: string; qtd: number; valor: number }>;
  top: Array<{ nome: string; qtd: number; valor: number }>;
}

export async function montarMesCasa(filial: { id: string; nome: string }, primeiroDia: string): Promise<MesCasa> {
  const F = filial.id;
  const ini = `${primeiroDia} 05:00:00-03`;
  const fim = `${proximoMes(primeiroDia)} 05:00:00-03`;
  const doMes = sql`p.filial_id = ${F} AND p.data_abertura >= ${ini}::timestamptz AND p.data_abertura < ${fim}::timestamptz AND p.data_delete IS NULL`;

  const [resumo, porDia, porHora, pagRows, topRows, diasEvento] = await Promise.all([
    q<{ contas: number; total: number; servico: number; desconto: number; ticket: number }>(sql`
      SELECT count(*)::int AS contas,
             coalesce(sum(p.valor_total), 0)::float8 AS total,
             coalesce(sum(p.total_servico), 0)::float8 AS servico,
             coalesce(sum(p.total_desconto), 0)::float8 AS desconto,
             coalesce(avg(p.valor_total) FILTER (WHERE p.valor_total > 0), 0)::float8 AS ticket
        FROM pedido p
       WHERE ${doMes}
    `),
    q<{ dia: string; contas: number; total: number }>(sql`
      SELECT ((p.data_abertura AT TIME ZONE ${TZ}) - interval '5 hours')::date::text AS dia,
             count(*)::int AS contas,
             coalesce(sum(p.valor_total), 0)::float8 AS total
        FROM pedido p
       WHERE ${doMes}
       GROUP BY 1
    `),
    q<{ hora: number; contas: number; total: number }>(sql`
      SELECT extract(hour FROM p.data_abertura AT TIME ZONE ${TZ})::int AS hora,
             count(*)::int AS contas,
             coalesce(sum(p.valor_total), 0)::float8 AS total
        FROM pedido p
       WHERE ${doMes}
       GROUP BY 1
    `),
    q<{ forma: string; qtd: number; valor: number }>(sql`
      SELECT coalesce(forma_efetiva, forma_pagamento,
                      CASE WHEN codigo_pedido_externo IS NULL THEN 'Fiado/permuta (baixa)' END, '?') AS forma,
             count(*)::int AS qtd,
             coalesce(sum(valor), 0)::float8 AS valor
        FROM pagamento
       WHERE filial_id = ${F}
         AND data_pagamento >= ${ini}::timestamptz AND data_pagamento < ${fim}::timestamptz
       GROUP BY 1
    `),
    q<{ nome: string; qtd: number; valor: number }>(sql`
      SELECT pi.nome_produto AS nome,
             coalesce(sum(pi.quantidade), 0)::float8 AS qtd,
             coalesce(sum(pi.valor_total), 0)::float8 AS valor
        FROM pedido_item pi
        JOIN pedido p ON p.id = pi.pedido_id
       WHERE ${doMes}
         AND pi.data_delete IS NULL
         AND coalesce(pi.codigo_item_pedido_tipo, 1) <> 2
       GROUP BY 1
       ORDER BY 3 DESC
       LIMIT 15
    `),
    q<{ dia: string }>(sql`
      SELECT DISTINCT dia::text AS dia FROM evento_ticket
       WHERE filial_id = ${F} AND dia >= ${primeiroDia}::date AND dia < ${proximoMes(primeiroDia)}::date
    `).catch(() => [] as Array<{ dia: string }>),
  ]);

  // Tickets de evento (recebidos por fora do PDV) entram no faturamento, igual ao diário.
  const eventosPorDia = new Map<string, number>();
  for (const { dia } of diasEvento) {
    const ev = await eventosDoDia(F, dia).catch(() => []);
    const v = ticketsDeEvento({ eventos: ev });
    if (v > 0) eventosPorDia.set(dia, v);
  }
  const eventos = [...eventosPorDia.values()].reduce((s, v) => s + v, 0);

  const r = resumo[0];
  let melhor: MesCasa['melhor'] = null;
  let dias = 0;
  for (const d of porDia) {
    if (!n(d.contas)) continue;
    dias++;
    const v = n(d.total) + (eventosPorDia.get(d.dia) ?? 0);
    if (!melhor || v > melhor.valor) melhor = { dia: d.dia, valor: v };
  }

  const periodos = PERIODOS.map((per) => {
    const hs = porHora.filter((h) => per.horas.includes(n(h.hora)));
    return { nome: per.nome, contas: hs.reduce((s, h) => s + n(h.contas), 0), valor: hs.reduce((s, h) => s + n(h.total), 0) };
  }).filter((p) => p.contas > 0);

  // "Crédito à vista" e "Crédito" são a mesma coisa pro dono (igual ao diário).
  const pagMap = new Map<string, { forma: string; qtd: number; valor: number }>();
  for (const p of pagRows) {
    const forma = String(p.forma).replace(/\s+à vista$/i, '').trim() || '?';
    const a = pagMap.get(forma) ?? { forma, qtd: 0, valor: 0 };
    a.qtd += n(p.qtd);
    a.valor += n(p.valor);
    pagMap.set(forma, a);
  }

  return {
    filialId: F,
    nome: filial.nome,
    contas: n(r?.contas),
    total: Math.round((n(r?.total) + eventos) * 100) / 100,
    servico: n(r?.servico),
    desconto: n(r?.desconto),
    eventos,
    ticket: n(r?.ticket),
    dias,
    melhor,
    periodos,
    pagamentos: [...pagMap.values()].sort((a, b) => b.valor - a.valor),
    top: topRows.map((t) => ({ nome: t.nome, qtd: n(t.qtd), valor: n(t.valor) })),
  };
}

async function filiaisDaOrganizacao(organizacaoId: string): Promise<Array<{ id: string; nome: string }>> {
  return q<{ id: string; nome: string }>(sql`
    SELECT id::text AS id, nome FROM filial WHERE organizacao_id = ${organizacaoId} ORDER BY cnpj, nome
  `);
}

/** Casas com venda no mês (as paradas/de teste ficam fora). */
export async function montarMesOrganizacao(organizacaoId: string, primeiroDia: string): Promise<MesCasa[]> {
  const filiais = await filiaisDaOrganizacao(organizacaoId);
  const casas = await Promise.all(filiais.map((f) => montarMesCasa(f, primeiroDia)));
  return casas.filter((c) => c.contas > 0);
}

/** Linha do aviso (cabe nos 600 do {{2}}): "Prainha Bar R$ 450.000 (2.100 contas) · … · Total R$ 1.200.000 com os 10% (sem os 10%: R$ …)". */
export function resumoMesUmaLinha(casas: MesCasa[]): string {
  if (!casas.length) return 'Sem movimento no mês.';
  const total = casas.reduce((s, c) => s + c.total, 0);
  const servico = casas.reduce((s, c) => s + c.servico, 0);
  const partes = casas.map((c) => `${c.nome} ${reais(c.total, false)} (${fmtN(c.contas)} contas)`);
  return `${partes.join(' · ')} · Total ${reais(total, false)} com os 10% (sem os 10%: ${reais(total - servico, false)})`;
}

function textoCasaMes(c: MesCasa): string {
  const l: string[] = [];
  l.push(`🏠 *${c.nome}*`);
  l.push(`Faturamento: *${reais(c.total)}* (com os 10%)`);
  l.push(`Sem os 10%: ${reais(c.total - c.servico)} · serviço ${reais(c.servico)}`);
  if (c.eventos > 0) l.push(`Inclui ${reais(c.eventos)} de tickets de evento`);
  l.push(`${fmtN(c.contas)} contas · ticket médio ${reais(c.ticket)}`);
  if (c.dias) l.push(`${c.dias} dias com movimento · média ${reais(c.total / c.dias)}/dia`);
  if (c.melhor) l.push(`Melhor dia: ${rotuloDia(c.melhor.dia)} ${reais(c.melhor.valor)}`);
  if (c.desconto > 0) l.push(`Descontos: ${reais(c.desconto)}`);
  if (c.periodos.length) {
    l.push('', '_Períodos_');
    for (const p of c.periodos) l.push(`• ${p.nome}: ${fmtN(p.contas)} contas · ${reais(p.valor)}`);
  }
  if (c.pagamentos.length) {
    l.push('', '_Recebido por forma_');
    for (const p of c.pagamentos) l.push(`• ${p.forma}: ${reais(p.valor)} (${fmtN(p.qtd)})`);
    l.push(`Total recebido: ${reais(c.pagamentos.reduce((s, p) => s + p.valor, 0))}`);
  }
  if (c.top.length) {
    l.push('', '_Mais vendidos_');
    c.top.forEach((t, i) => l.push(`${i + 1}. ${t.nome} — ${fmtN(t.qtd)} · ${reais(t.valor, false)}`));
  }
  return l.join('\n');
}

/** Mensagens de texto (até ~3.800 caracteres cada) com o mês inteiro. */
export function textoMes(casas: MesCasa[], primeiroDia: string): string[] {
  const total = casas.reduce((s, c) => s + c.total, 0);
  const servico = casas.reduce((s, c) => s + c.servico, 0);
  const contas = casas.reduce((s, c) => s + c.contas, 0);
  const cabecalho =
    `📊 *Resultado de ${rotuloMes(primeiroDia)}*\n` +
    `${casas.length} ${casas.length === 1 ? 'casa' : 'casas'} · ${reais(total)} em ${fmtN(contas)} contas (com os 10%)\n` +
    `Sem os 10%: ${reais(total - servico)}` +
    (casas.length > 1 ? `\n${casas.map((c) => `• ${c.nome}: ${reais(c.total, false)}`).join('\n')}` : '');
  const blocos = [cabecalho, ...casas.map(textoCasaMes)];
  const msgs: string[] = [];
  let atual = '';
  for (const b of blocos) {
    const bloco = b.length > 3800 ? `${b.slice(0, 3790)}…` : b;
    if (atual && atual.length + bloco.length + 2 > 3800) {
      msgs.push(atual);
      atual = '';
    }
    atual = atual ? `${atual}\n\n${bloco}` : bloco;
  }
  if (atual) msgs.push(atual);
  return msgs;
}

async function enviarTextoMes(
  alvo: { organizacaoId: string; telefone: string; para: string; phoneNumberId: string },
  mes: string,
  origem: OrigemEnvio,
  casas: MesCasa[],
): Promise<boolean> {
  for (const corpo of textoMes(casas, mes)) {
    const r = await enviarTexto(alvo.phoneNumberId, alvo.para, corpo);
    await registrar({
      organizacaoId: alvo.organizacaoId,
      dia: mes,
      telefone: alvo.telefone,
      canal: 'mensal',
      origem,
      ok: !!r.waMessageId,
      erro: r.erro ?? (r.waMessageId ? 'texto completo' : null),
      waMessageId: r.waMessageId,
      phoneNumberId: alvo.phoneNumberId,
    });
    if (!r.waMessageId) return false;
  }
  return true;
}

export interface ResultadoMesDono {
  organizacaoId: string;
  telefone: string;
  mes: string;
  ok: boolean;
  pulado?: boolean;
  erro?: string;
}

/**
 * Dia 01: manda o mês anterior pra quem recebe o relatório completo (até o
 * dia 05 repesca quem não recebeu). Depois disso não faz nada, a não ser com
 * `forcar` (manda o último mês fechado).
 * `repetir` manda mesmo pra quem já recebeu.
 */
export async function enviarMesDono(
  opts: { origem?: OrigemEnvio; forcar?: boolean; repetir?: boolean; organizacaoId?: string; telefones?: string[] } = {},
): Promise<ResultadoMesDono[]> {
  const origem = opts.origem ?? 'cron';
  const hoje = somaDias(ultimoDiaFechado(), 1);
  // Dia 01 é o normal; até o dia 05 o cron tenta de novo quem ainda não
  // recebeu (o registro ok do mês trava a repetição).
  if (!opts.forcar && hoje.slice(8, 10) > '05') return [];
  const mes = mesAnteriorDe(hoje);
  const configs = await db
    .select({ organizacaoId: schema.relatorioDiarioConfig.organizacaoId })
    .from(schema.relatorioDiarioConfig)
    .where(eq(schema.relatorioDiarioConfig.ativo, true));
  const saida: ResultadoMesDono[] = [];
  for (const { organizacaoId } of configs) {
    if (opts.organizacaoId && opts.organizacaoId !== organizacaoId) continue;
    const cfg = await lerConfig(organizacaoId);
    const alvos = opts.telefones?.length ? cfg.telefones.filter((t) => opts.telefones?.includes(t)) : cfg.telefones;
    if (!alvos.length) continue;
    let casas: MesCasa[] | null = null;
    for (const telefone of alvos) {
      if (!opts.repetir) {
        const [ja] = await db
          .select({ id: schema.relatorioDiarioEnvio.id })
          .from(schema.relatorioDiarioEnvio)
          .where(
            and(
              eq(schema.relatorioDiarioEnvio.organizacaoId, organizacaoId),
              eq(schema.relatorioDiarioEnvio.telefone, telefone),
              eq(schema.relatorioDiarioEnvio.ok, true),
              eq(schema.relatorioDiarioEnvio.canal, 'mensal'),
              eq(schema.relatorioDiarioEnvio.dia, mes),
            ),
          )
          .limit(1);
        if (ja) {
          saida.push({ organizacaoId, telefone, mes, ok: true, pulado: true });
          continue;
        }
      }
      casas ??= await montarMesOrganizacao(organizacaoId, mes);
      // Conversa aberta: o mês inteiro direto em texto.
      const numeroDaJanela = await janelaAberta(organizacaoId, telefone);
      if (numeroDaJanela && (await enviarTextoMes({ organizacaoId, telefone, para: telefone, phoneNumberId: numeroDaJanela }, mes, origem, casas))) {
        saida.push({ organizacaoId, telefone, mes, ok: true });
        continue;
      }
      const m = await enviarModelo(telefone, mes, resumoMesUmaLinha(casas), rotuloMes(mes), `mensal:${mes}`);
      await registrar({
        organizacaoId,
        dia: mes,
        telefone,
        canal: 'mensal',
        origem,
        ok: !!m.waMessageId,
        erro: m.erro ?? null,
        waMessageId: m.waMessageId,
        phoneNumberId: m.phoneNumberId || null,
      });
      saida.push({ organizacaoId, telefone, mes, ok: !!m.waMessageId, erro: m.erro });
    }
  }
  return saida;
}

/** Toque no "Ver resumo" do aviso do mês: manda o mês inteiro em texto. */
export async function responderPedidoMensal(p: PedidoRelatorio): Promise<void> {
  if (p.repetida) return;
  try {
    const casas = await montarMesOrganizacao(p.organizacaoId, p.dia);
    await enviarTextoMes(p, p.dia, p.origem, casas);
  } catch (e) {
    await registrar({
      organizacaoId: p.organizacaoId,
      dia: p.dia,
      telefone: p.telefone,
      canal: 'mensal',
      origem: p.origem,
      ok: false,
      erro: e instanceof Error ? e.message : String(e),
      phoneNumberId: p.phoneNumberId,
    }).catch(() => {});
  }
}
