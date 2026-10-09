// Relatório diário de operação de uma casa: movimento, equipe pelo ponto,
// cancelamentos (demora), tempos do KDS, avaliações e pontos de atenção.
//
// O "dia" é o dia operacional: 05:00 → 05:00 (BRT). Tudo aqui é LEITURA.
// Fontes: pedido / pedido_item / pagamento / ponto_batida / ponto_dia /
// cancelamento_item / avaliacao / reserva / lista_espera / loja_queda.
//
// Limite conhecido: no banco próprio as marcas do KDS (pronto_em/entregue_em)
// ainda chegam pela metade na nuvem — `kds.cobertura` diz quanto do dia tem
// tempo medido, e o relatório só afirma sobre o que tem marca.

import { db } from '@concilia/db';
import { sql, type SQL } from 'drizzle-orm';
import { dateToBrYmd } from './datas';
import { chamarLojaCaixa } from './caixa-loja';

const TZ = 'America/Sao_Paulo';
const DIA_MS = 24 * 3600 * 1000;

/** YYYY-MM-DD + n dias (meio-dia BRT pra não escorregar de dia). */
export function somaDias(ymd: string, n: number): string {
  return dateToBrYmd(new Date(new Date(`${ymd}T12:00:00-03:00`).getTime() + n * DIA_MS));
}

/** Último dia operacional já fechado (o dia vira às 05:00 BRT). */
export function ultimoDiaFechado(agora: Date = new Date()): string {
  const hojeOperacional = dateToBrYmd(new Date(agora.getTime() - 5 * 3600 * 1000));
  return somaDias(hojeOperacional, -1);
}

const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "sábado 03/10" */
export function rotuloDia(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00-03:00`);
  return `${SEMANA[d.getUTCDay()]} ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

export function reais(n: number, centavos = true): string {
  return `R$ ${n.toLocaleString('pt-BR', {
    minimumFractionDigits: centavos ? 2 : 0,
    maximumFractionDigits: centavos ? 2 : 0,
  })}`;
}

/** "1 conta" / "3 contas" */
function pl(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** Como a função entra numa frase: "4 garçons", "2 no bar". */
function equipeEmTexto(chave: string, n: number): string {
  switch (chave) {
    case 'garcom':
      return pl(n, 'garçom', 'garçons');
    case 'cumim':
      return pl(n, 'cumim', 'cumins');
    case 'cozinha':
      return pl(n, 'cozinheiro', 'cozinheiros');
    case 'auxcozinha':
      return `${n} aux. de cozinha`;
    case 'cozinhaoutros':
      return `${n} na cozinha (outros)`;
    case 'bar':
      return `${n} no bar`;
    case 'caixa':
      return `${n} no caixa`;
    case 'recepcao':
      return `${n} na recepção`;
    case 'gerencia':
      return `${n} na gerência`;
    case 'limpeza':
      return `${n} na limpeza`;
    case 'manobrista':
      return pl(n, 'manobrista', 'manobristas');
    case 'salaosemcargo':
      return `${n} no salão sem cargo no cadastro`;
    default:
      return pl(n, 'outro', 'outros');
  }
}

function horas(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface PeriodoDia {
  nome: string;
  contas: number;
  total: number;
  /** maior nº de contas abertas ao mesmo tempo no período */
  pico: number;
  picoHora: string | null;
  /** quem estava no ponto na hora do pico */
  garconsNoPico: number;
  cozinhaNoPico: number;
}

export interface PessoaPonto {
  nome: string;
  cargo: string | null;
  entrada: string | null;
  saida: string | null;
  semSaida: boolean;
  minutos: number | null;
}

export interface FuncaoEquipe {
  chave: string;
  rotulo: string;
  pessoas: PessoaPonto[];
}

export interface MotivoCancelamento {
  motivo: string;
  itens: number;
  valor: number;
  mesas: number;
}

export interface PracaDia {
  nome: string;
  itens: number;
  valor: number;
  /** itens com hora de "pronto" na nuvem */
  medidos: number;
  medianaMin: number | null;
  metaMin: number;
  acimaDaMeta: number;
}

/** Lançamento de dinheiro na gaveta (sangria / despesa / suprimento). */
export interface MovGaveta {
  /** HH:MM (BRT) */
  hora: string;
  /** DD/MM (BRT) */
  diaMes: string;
  caixa: number;
  /** de quem é a gaveta (operador do caixa) */
  caixaDe: string;
  valor: number;
  /** quem levou o dinheiro — nulo quando o lançamento não diz */
  levou: string | null;
  motivo: string;
  /** quem lançou no sistema */
  lancou: string | null;
}

export interface GavetaDia {
  codigo: number;
  quem: string;
  /** "DD/MM HH:MM" (BRT) */
  abertoEm: string;
  fechadoEm: string | null;
  aberta: boolean;
  /** abriu dentro do dia do relatório (falso = veio de um dia anterior) */
  doDia: boolean;
  /** dias corridos aberta até agora (só quando ainda aberta) */
  diasAberta: number;
  fundo: number;
  /** dinheiro recebido, entradas e saídas do caixa inteiro (no trecho lido) */
  dinheiro: number;
  entradas: number;
  saidas: number;
  /** fechada: o saldo que a loja calculou; aberta: fundo + dinheiro + entradas − saídas (nulo se a gaveta é mais velha que a leitura) */
  esperado: number | null;
  contado: number | null;
  /** contado − esperado */
  diferenca: number | null;
  /** passagem de caixa: o fechamento anterior que este fundo deveria repetir (nulo = sem caixa anterior no trecho lido, ou abriu zerada) */
  passagem?: PassagemGaveta | null;
}

/** "Quando um caixa fecha, o outro abre com o mesmo saldo." */
export interface PassagemGaveta {
  /** quem fechou o caixa anterior (dois nomes quando a gaveta juntou dois caixas) */
  de: string;
  /** "DD/MM HH:MM" (BRT) do fechamento anterior */
  fechouEm: string;
  /** saldo com que o anterior fechou (contado; sem contagem, o esperado) */
  saldo: number;
  /** fundo desta gaveta − saldo anterior: negativo = dinheiro saiu entre um caixa e outro sem registro */
  diferenca: number;
}

export interface MaquininhaAberta {
  codigo: number;
  quem: string;
  /** "DD/MM HH:MM" (BRT) */
  desde: string;
  dias: number;
  pagamentos: number;
  total: number;
  /** confere e fecha sozinha na próxima passada da madrugada */
  fecharia: boolean;
  categoria: string | null;
  motivo: string | null;
  /** iFood Online que ficou fora da conferência */
  canal: number;
  /** travada de verdade (não é só o extrato do próprio dia que ainda não chegou) */
  travada: boolean;
}

/** Caixa do dia, lido direto da loja. `ok = false` = a loja não respondeu. */
export interface CaixaDia {
  ok: boolean;
  erro: string | null;
  gavetas: GavetaDia[];
  /** saídas e entradas de dinheiro lançadas dentro do dia (05:00 → 05:00) */
  saidas: MovGaveta[];
  entradas: MovGaveta[];
  totalSaidas: number;
  totalEntradas: number;
  /** saídas somadas por quem levou */
  porPessoa: Array<{ nome: string; valor: number; n: number }>;
  /** caixas de maquininha abertos AGORA (nulo = a conferência não respondeu) */
  maquininhas: MaquininhaAberta[] | null;
}

export interface RelatorioCasa {
  filialId: string;
  nome: string;
  dia: string;
  /** false = casa sem venda nenhuma nos últimos 30 dias (filial de teste / parada) */
  ativa: boolean;
  temMovimento: boolean;
  movimento: {
    contas: number;
    total: number;
    servico: number;
    desconto: number;
    ticket: number;
    permanenciaMedianaMin: number | null;
  };
  semanaPassada: { contas: number; total: number };
  periodos: PeriodoDia[];
  porHora: Array<{ hora: number; contas: number; total: number }>;
  pagamentos: Array<{ forma: string; qtd: number; valor: number }>;
  recebido: number;
  pracas: PracaDia[];
  top: Array<{ nome: string; qtd: number; valor: number }>;
  equipe: { total: number; funcoes: FuncaoEquipe[]; semCargo: number };
  cancelamentos: {
    itens: number;
    valor: number;
    porMotivo: MotivoCancelamento[];
    demora: { itens: number; valor: number; mesas: number; de: string | null; ate: string | null };
    /** mesas em que o cancelado por demora passou do que a mesa pagou */
    mesasQueDesistiram: Array<{ numero: number; cancelado: number; pago: number | null; hora: string }>;
    /** `hora` = cancelamento; `lancado` = quando o item entrou na conta (nulo se a loja não mandou) */
    maiores: Array<{ hora: string; lancado: string | null; numero: number | null; nome: string; valor: number; motivo: string; quem: string | null }>;
  };
  kds: {
    itens: number;
    medidos: number;
    /** 0–1: quanto do dia tem tempo medido */
    cobertura: number;
    piores: Array<{ nome: string; numero: number | null; hora: string; min: number; praca: string }>;
  };
  avaliacoes: {
    total: number;
    media: number | null;
    baixas: Array<{ nota: number; mesa: number | null; hora: string; comentario: string | null }>;
  };
  reservas: { total: number; pessoas: number; sentadas: number; noShow: number; canceladas: number };
  listaEspera: number;
  quedas: Array<{ hora: string; minutos: number }>;
  descontos: Array<{ numero: number | null; desconto: number; pago: number }>;
  jornadasLongas: Array<{ nome: string; minutos: number }>;
  /** gavetas, saídas de dinheiro e maquininhas sem fechar — nulo se a casa não tem a loja ligada */
  caixa: CaixaDia | null;
  atencao: string[];
}

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

async function q<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Função da pessoa a partir do cargo/setor do cadastro (texto livre no RH). */
function funcaoDe(cargo: string | null, setor: string | null): { chave: string; rotulo: string; ordem: number } {
  const c = (cargo ?? '').toLowerCase();
  const s = (setor ?? '').toUpperCase();
  if (c.includes('garç') || c.includes('garc')) return { chave: 'garcom', rotulo: 'Garçons', ordem: 1 };
  if (c.includes('cumim')) return { chave: 'cumim', rotulo: 'Cumins', ordem: 2 };
  if (c.includes('auxiliar de cozinha')) return { chave: 'auxcozinha', rotulo: 'Aux. de cozinha', ordem: 4 };
  if (c.includes('cozinheir') || c.includes('chef')) return { chave: 'cozinha', rotulo: 'Cozinheiros', ordem: 3 };
  if (c.includes('bartender') || c.includes('barman')) return { chave: 'bar', rotulo: 'Bar', ordem: 5 };
  if (c.includes('caixa')) return { chave: 'caixa', rotulo: 'Caixa', ordem: 6 };
  if (c.includes('recep')) return { chave: 'recepcao', rotulo: 'Recepção', ordem: 7 };
  if (c.includes('gerente')) return { chave: 'gerencia', rotulo: 'Gerência', ordem: 8 };
  if (c.includes('limpeza') || s === 'LIMPEZA') return { chave: 'limpeza', rotulo: 'Limpeza', ordem: 9 };
  if (c.includes('manobr')) return { chave: 'manobrista', rotulo: 'Manobrista', ordem: 10 };
  if (s === 'COZINHA') return { chave: 'cozinhaoutros', rotulo: 'Cozinha (outros)', ordem: 4.5 };
  if (s === 'SALAO') return { chave: 'salaosemcargo', rotulo: 'Salão (sem cargo no cadastro)', ordem: 2.5 };
  if (s === 'BAR') return { chave: 'bar', rotulo: 'Bar', ordem: 5 };
  return { chave: 'outros', rotulo: 'Outros', ordem: 11 };
}

const FUNCOES_COZINHA = new Set(['cozinha', 'auxcozinha', 'cozinhaoutros']);

/** Faixas do dia operacional, em minutos a partir das 05:00. */
const PERIODOS: Array<{ nome: string; de: number; ate: number }> = [
  { nome: 'Manhã', de: 0, ate: 360 }, // 05:00–11:00
  { nome: 'Almoço', de: 360, ate: 600 }, // 11:00–15:00
  { nome: 'Tarde', de: 600, ate: 780 }, // 15:00–18:00
  { nome: 'Noite', de: 780, ate: 1440 }, // 18:00–05:00
];

/** hora cheia (0–23) → minutos desde as 05:00 do dia operacional */
const minutoDaHora = (h: number) => ((h + 19) % 24) * 60;

interface Turno {
  de: number;
  ate: number;
}

interface PessoaInterna extends PessoaPonto {
  chave: string;
  turnos: Turno[];
}

const presentes = (pessoas: PessoaInterna[], minuto: number, filtro: (p: PessoaInterna) => boolean) =>
  pessoas.filter((p) => filtro(p) && p.turnos.some((t) => t.de <= minuto && minuto < t.ate)).length;

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

/** Metas de tempo por praça (código → minutos); `padrao` vale pras demais. */
export interface MetasKds {
  padrao: number;
  porPraca: Record<number, number>;
}

export async function montarRelatorioCasa(
  filial: { id: string; nome: string },
  dia: string,
  metas: MetasKds = { padrao: 15, porPraca: {} },
): Promise<RelatorioCasa> {
  const F = filial.id;
  const ini = `${dia} 05:00:00-03`;
  const fim = `${somaDias(dia, 1)} 05:00:00-03`;
  const doDia = sql`p.filial_id = ${F} AND p.data_abertura >= ${ini}::timestamptz AND p.data_abertura < ${fim}::timestamptz AND p.data_delete IS NULL`;

  const [
    resumo,
    porHoraRows,
    ocupacao,
    pagRows,
    itens,
    topRows,
    pontoRows,
    cancRows,
    desistRows,
    avalRows,
    reservaRows,
    esperaRows,
    quedaRows,
    descRows,
  ] = await Promise.all([
    q<{
      contas: number;
      total: number;
      servico: number;
      desconto: number;
      ticket: number;
      perm: number | null;
      contas_sp: number;
      total_sp: number;
      ativa: boolean;
    }>(sql`
      SELECT count(*)::int AS contas,
             coalesce(sum(p.valor_total), 0)::float8 AS total,
             coalesce(sum(p.total_servico), 0)::float8 AS servico,
             coalesce(sum(p.total_desconto), 0)::float8 AS desconto,
             coalesce(avg(p.valor_total) FILTER (WHERE p.valor_total > 0), 0)::float8 AS ticket,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (p.data_fechamento - p.data_abertura)) / 60)
                FILTER (WHERE p.data_fechamento IS NOT NULL))::float8 AS perm,
             (SELECT count(*)::int FROM pedido s
               WHERE s.filial_id = ${F} AND s.data_delete IS NULL
                 AND s.data_abertura >= ${ini}::timestamptz - interval '7 days'
                 AND s.data_abertura < ${fim}::timestamptz - interval '7 days') AS contas_sp,
             (SELECT coalesce(sum(s.valor_total), 0)::float8 FROM pedido s
               WHERE s.filial_id = ${F} AND s.data_delete IS NULL
                 AND s.data_abertura >= ${ini}::timestamptz - interval '7 days'
                 AND s.data_abertura < ${fim}::timestamptz - interval '7 days') AS total_sp,
             EXISTS (SELECT 1 FROM pedido a
               WHERE a.filial_id = ${F}
                 AND a.data_abertura >= ${ini}::timestamptz - interval '30 days'
                 AND a.data_abertura < ${fim}::timestamptz) AS ativa
        FROM pedido p
       WHERE ${doDia}
    `),
    q<{ hora: number; contas: number; total: number }>(sql`
      SELECT extract(hour FROM p.data_abertura AT TIME ZONE ${TZ})::int AS hora,
             count(*)::int AS contas,
             coalesce(sum(p.valor_total), 0)::float8 AS total
        FROM pedido p
       WHERE ${doDia}
       GROUP BY 1
    `),
    q<{ minuto: number; hora: string; abertas: number }>(sql`
      SELECT (extract(epoch FROM (t.h - ${ini}::timestamptz)) / 60)::int AS minuto,
             to_char(t.h AT TIME ZONE ${TZ}, 'HH24:MI') AS hora,
             (SELECT count(*) FROM pedido p
               WHERE ${doDia}
                 AND p.data_abertura <= t.h
                 AND coalesce(p.data_fechamento, p.data_abertura) > t.h)::int AS abertas
        FROM generate_series(${ini}::timestamptz, ${fim}::timestamptz - interval '30 minutes', interval '30 minutes') AS t(h)
       ORDER BY 1
    `),
    q<{ forma: string; qtd: number; valor: number; sem_conta: number }>(sql`
      SELECT coalesce(forma_efetiva, forma_pagamento,
                      CASE WHEN codigo_pedido_externo IS NULL THEN 'Fiado/permuta (baixa)' END, '?') AS forma,
             count(*)::int AS qtd,
             coalesce(sum(valor), 0)::float8 AS valor,
             coalesce(sum(valor) FILTER (WHERE codigo_pedido_externo IS NULL), 0)::float8 AS sem_conta
        FROM pagamento
       WHERE filial_id = ${F}
         AND data_pagamento >= ${ini}::timestamptz AND data_pagamento < ${fim}::timestamptz
       GROUP BY 1
    `),
    // Um por item lançado (sem complemento), com a praça do produto e os tempos do KDS.
    q<{
      nome: string;
      numero: number | null;
      hora: string;
      valor: number;
      praca: string | null;
      praca_codigo: number | null;
      producao_min: number | null;
    }>(sql`
      SELECT pi.nome_produto AS nome,
             p.numero,
             to_char(pi.data_hora_cadastro AT TIME ZONE ${TZ}, 'HH24:MI') AS hora,
             coalesce(pi.valor_total, 0)::float8 AS valor,
             a.nome AS praca,
             a.codigo_externo AS praca_codigo,
             (extract(epoch FROM (pi.pronto_em - pi.data_hora_cadastro)) / 60)::float8 AS producao_min
        FROM pedido_item pi
        JOIN pedido p ON p.id = pi.pedido_id
        LEFT JOIN produto pr
          ON (pi.produto_id IS NOT NULL AND pr.id = pi.produto_id)
          OR (pi.produto_id IS NULL AND pr.filial_id = p.filial_id AND pr.codigo_externo = pi.codigo_produto_externo)
        LEFT JOIN area_producao a ON a.filial_id = p.filial_id AND a.codigo_externo = pr.codigo_cozinha
       WHERE ${doDia}
         AND pi.data_delete IS NULL
         AND coalesce(pi.codigo_item_pedido_tipo, 1) <> 2
    `),
    q<{ nome: string; qtd: number; valor: number }>(sql`
      SELECT pi.nome_produto AS nome,
             coalesce(sum(pi.quantidade), 0)::float8 AS qtd,
             coalesce(sum(pi.valor_total), 0)::float8 AS valor
        FROM pedido_item pi
        JOIN pedido p ON p.id = pi.pedido_id
       WHERE ${doDia}
         AND pi.data_delete IS NULL
         AND coalesce(pi.codigo_item_pedido_tipo, 1) <> 2
       GROUP BY 1
       ORDER BY 3 DESC
       LIMIT 8
    `),
    q<{
      nome: string;
      cargo: string | null;
      setor: string | null;
      batidas: Array<{ m: number; h: string; t: string | null }>;
      total_min: number | null;
    }>(sql`
      SELECT f.nome, f.cargo, f.setor,
             json_agg(json_build_object(
               'm', (extract(epoch FROM (b.quando - ${ini}::timestamptz)) / 60)::int,
               'h', to_char(b.quando AT TIME ZONE ${TZ}, 'HH24:MI'),
               't', b.tipo) ORDER BY b.quando) AS batidas,
             (SELECT d.total_min FROM ponto_dia d
               WHERE d.filial_id = ${F} AND d.funcionario_id = f.id AND d.dia = ${dia}::date
               LIMIT 1) AS total_min
        FROM ponto_batida b
        JOIN funcionario f ON f.id = b.funcionario_id
       WHERE b.filial_id = ${F} AND b.dia_operacional = ${dia}::date AND b.excluida_em IS NULL
       GROUP BY f.id, f.nome, f.cargo, f.setor
       ORDER BY f.nome
    `),
    q<{
      hora: string;
      lancado: string | null;
      numero: number | null;
      nome: string | null;
      valor: number;
      motivo: string | null;
      login: string | null;
      gerente: string | null;
    }>(sql`
      SELECT to_char(c.quando AT TIME ZONE ${TZ}, 'HH24:MI') AS hora,
             -- hora do lançamento: a que a loja mandou; sem ela, a do item que
             -- sobrou na conta (cancelamento parcial, "1 de 3×")
             to_char(coalesce(c.lancado_em, (
               SELECT min(pi.data_hora_cadastro) FROM pedido_item pi
                WHERE pi.filial_id = c.filial_id AND pi.codigo_externo = c.item_codigo
                  AND pi.data_hora_cadastro <= c.quando
             )) AT TIME ZONE ${TZ}, 'HH24:MI') AS lancado,
             c.numero, c.nome, coalesce(c.valor, 0)::float8 AS valor, c.motivo, c.login, c.gerente
        FROM cancelamento_item c
       WHERE c.filial_id = ${F} AND c.quando >= ${ini}::timestamptz AND c.quando < ${fim}::timestamptz
       ORDER BY c.quando
    `),
    q<{ numero: number; cancelado: number; pago: number | null; hora: string }>(sql`
      SELECT c.numero,
             coalesce(sum(c.valor), 0)::float8 AS cancelado,
             max(p.valor_total)::float8 AS pago,
             min(to_char(c.quando AT TIME ZONE ${TZ}, 'HH24:MI')) AS hora
        FROM cancelamento_item c
        LEFT JOIN pedido p
          ON p.filial_id = c.filial_id AND p.numero = c.numero AND p.data_delete IS NULL
         AND c.quando >= p.data_abertura
         AND c.quando <= coalesce(p.data_fechamento, c.quando) + interval '2 minutes'
       WHERE c.filial_id = ${F} AND c.quando >= ${ini}::timestamptz AND c.quando < ${fim}::timestamptz
         AND c.motivo ILIKE 'Demora%' AND c.numero IS NOT NULL
       GROUP BY c.numero
    `),
    q<{ nota: number; mesa: number | null; comentario: string | null; hora: string }>(sql`
      SELECT nota, mesa, comentario, to_char(criado_em AT TIME ZONE ${TZ}, 'HH24:MI') AS hora
        FROM avaliacao
       WHERE filial_id = ${F} AND criado_em >= ${ini}::timestamptz AND criado_em < ${fim}::timestamptz
       ORDER BY criado_em
    `),
    q<{ status: string; n: number; pessoas: number }>(sql`
      SELECT status, count(*)::int AS n, coalesce(sum(pessoas), 0)::int AS pessoas
        FROM reserva
       WHERE filial_id = ${F} AND data = ${dia}::date
       GROUP BY 1
    `),
    q<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM lista_espera
       WHERE filial_id = ${F} AND criado_em >= ${ini}::timestamptz AND criado_em < ${fim}::timestamptz
    `),
    q<{ hora: string; segundos: number }>(sql`
      SELECT to_char(caiu_em AT TIME ZONE ${TZ}, 'HH24:MI') AS hora, segundos
        FROM loja_queda
       WHERE filial_id = ${F} AND caiu_em >= ${ini}::timestamptz AND caiu_em < ${fim}::timestamptz
       ORDER BY caiu_em
    `),
    q<{ numero: number | null; desconto: number; pago: number }>(sql`
      SELECT p.numero, p.total_desconto::float8 AS desconto, coalesce(p.valor_total, 0)::float8 AS pago
        FROM pedido p
       WHERE ${doDia} AND p.total_desconto >= 100
       ORDER BY p.total_desconto DESC
       LIMIT 5
    `),
  ]);

  const r0 = resumo[0];
  const movimento = {
    contas: num(r0?.contas),
    total: num(r0?.total),
    servico: num(r0?.servico),
    desconto: num(r0?.desconto),
    ticket: num(r0?.ticket),
    permanenciaMedianaMin: r0?.perm == null ? null : num(r0.perm),
  };

  // --- Equipe pelo ponto -----------------------------------------------------
  const pessoas: PessoaInterna[] = pontoRows.map((p) => {
    const f = funcaoDe(p.cargo, p.setor);
    const turnos: Turno[] = [];
    let aberto: number | null = null;
    for (const b of p.batidas ?? []) {
      if (b.t === 'saida') {
        if (aberto != null) turnos.push({ de: aberto, ate: b.m });
        aberto = null;
      } else if (aberto == null) {
        aberto = b.m;
      }
    }
    const semSaida = aberto != null;
    // Entrada sem saída: conta 10 h de presença (teto no fim do dia operacional).
    if (aberto != null) turnos.push({ de: aberto, ate: Math.min(aberto + 600, 1440) });
    const entradas = (p.batidas ?? []).filter((b) => b.t !== 'saida');
    const saidas = (p.batidas ?? []).filter((b) => b.t === 'saida');
    return {
      nome: p.nome,
      cargo: p.cargo,
      entrada: entradas[0]?.h ?? null,
      saida: semSaida ? null : (saidas[saidas.length - 1]?.h ?? null),
      semSaida,
      minutos: p.total_min ?? (semSaida ? null : turnos.reduce((s, t) => s + (t.ate - t.de), 0)),
      chave: f.chave,
      turnos,
    };
  });
  const funcoesMap = new Map<string, FuncaoEquipe & { ordem: number }>();
  for (const p of pontoRows) {
    const f = funcaoDe(p.cargo, p.setor);
    if (!funcoesMap.has(f.chave)) funcoesMap.set(f.chave, { chave: f.chave, rotulo: f.rotulo, ordem: f.ordem, pessoas: [] });
  }
  for (const p of pessoas) {
    const { chave: _c, turnos: _t, ...publica } = p;
    funcoesMap.get(p.chave)?.pessoas.push(publica);
  }
  const funcoes = [...funcoesMap.values()].sort((a, b) => a.ordem - b.ordem).map(({ ordem: _o, ...f }) => f);

  // --- Períodos e pico ---------------------------------------------------------
  const porHora = porHoraRows
    .map((h) => ({ hora: num(h.hora), contas: num(h.contas), total: num(h.total) }))
    .sort((a, b) => minutoDaHora(a.hora) - minutoDaHora(b.hora));
  const periodos: PeriodoDia[] = [];
  for (const per of PERIODOS) {
    const horasDoPeriodo = porHora.filter((h) => {
      const m = minutoDaHora(h.hora);
      return m >= per.de && m < per.ate;
    });
    const contas = horasDoPeriodo.reduce((s, h) => s + h.contas, 0);
    if (!contas) continue;
    let pico = 0;
    let picoHora: string | null = null;
    let picoMin = per.de;
    for (const o of ocupacao) {
      if (o.minuto >= per.de && o.minuto < per.ate && num(o.abertas) > pico) {
        pico = num(o.abertas);
        picoHora = o.hora;
        picoMin = num(o.minuto);
      }
    }
    periodos.push({
      nome: per.nome,
      contas,
      total: horasDoPeriodo.reduce((s, h) => s + h.total, 0),
      pico,
      picoHora,
      garconsNoPico: presentes(pessoas, picoMin, (p) => p.chave === 'garcom'),
      cozinhaNoPico: presentes(pessoas, picoMin, (p) => FUNCOES_COZINHA.has(p.chave)),
    });
  }

  // --- Pagamentos ("Crédito à vista" e "Crédito" são a mesma coisa pro dono) ---
  const pagMap = new Map<string, { forma: string; qtd: number; valor: number }>();
  for (const p of pagRows) {
    const forma = String(p.forma).replace(/\s+à vista$/i, '').trim() || '?';
    const atual = pagMap.get(forma) ?? { forma, qtd: 0, valor: 0 };
    atual.qtd += num(p.qtd);
    atual.valor += num(p.valor);
    pagMap.set(forma, atual);
  }
  const pagamentos = [...pagMap.values()].sort((a, b) => b.valor - a.valor);
  const recebido = pagamentos.reduce((s, p) => s + p.valor, 0);
  // Recebimento sem conta = baixa de fiado/permuta (dívida antiga quitada hoje).
  // Entra no recebido, mas não é venda do dia: fica fora da comparação com as contas.
  const recebidoSemConta = pagRows.reduce((s, p) => s + num(p.sem_conta), 0);

  // --- Praças + tempos do KDS --------------------------------------------------
  const pracaMap = new Map<string, { nome: string; codigo: number | null; itens: number; valor: number; tempos: number[] }>();
  for (const it of itens) {
    const nome = it.praca ?? 'Sem praça';
    const p = pracaMap.get(nome) ?? { nome, codigo: it.praca_codigo, itens: 0, valor: 0, tempos: [] };
    p.itens += 1;
    p.valor += num(it.valor);
    if (it.producao_min != null && num(it.producao_min) >= 0) p.tempos.push(num(it.producao_min));
    pracaMap.set(nome, p);
  }
  const pracas: PracaDia[] = [...pracaMap.values()]
    .sort((a, b) => b.valor - a.valor)
    .map((p) => {
      const meta = (p.codigo != null ? metas.porPraca[p.codigo] : undefined) ?? metas.padrao;
      return {
        nome: p.nome,
        itens: p.itens,
        valor: p.valor,
        medidos: p.tempos.length,
        medianaMin: mediana(p.tempos),
        metaMin: meta,
        acimaDaMeta: p.tempos.filter((t) => t > meta).length,
      };
    });
  const medidos = itens.filter((i) => i.producao_min != null && num(i.producao_min) >= 0);
  const kds = {
    itens: itens.length,
    medidos: medidos.length,
    cobertura: itens.length ? medidos.length / itens.length : 0,
    piores: [...medidos]
      .sort((a, b) => num(b.producao_min) - num(a.producao_min))
      .slice(0, 5)
      .filter((i) => num(i.producao_min) > metas.padrao)
      .map((i) => ({
        nome: i.nome,
        numero: i.numero,
        hora: i.hora,
        min: Math.round(num(i.producao_min)),
        praca: i.praca ?? 'Sem praça',
      })),
  };

  // --- Cancelamentos -------------------------------------------------------------
  const motivoMap = new Map<string, { motivo: string; itens: number; valor: number; mesas: Set<number> }>();
  for (const c of cancRows) {
    const bruto = (c.motivo ?? '').trim() || 'Sem motivo';
    const motivo = /^outro\b/i.test(bruto) ? 'Outro' : bruto;
    const m = motivoMap.get(motivo) ?? { motivo, itens: 0, valor: 0, mesas: new Set<number>() };
    m.itens += 1;
    m.valor += num(c.valor);
    if (c.numero != null) m.mesas.add(c.numero);
    motivoMap.set(motivo, m);
  }
  const porMotivo = [...motivoMap.values()]
    .sort((a, b) => b.valor - a.valor)
    .map((m) => ({ motivo: m.motivo, itens: m.itens, valor: m.valor, mesas: m.mesas.size }));
  const demoras = cancRows.filter((c) => /^demora/i.test(c.motivo ?? ''));
  const cancelamentos = {
    itens: cancRows.length,
    valor: cancRows.reduce((s, c) => s + num(c.valor), 0),
    porMotivo,
    demora: {
      itens: demoras.length,
      valor: demoras.reduce((s, c) => s + num(c.valor), 0),
      mesas: new Set(demoras.map((c) => c.numero).filter((n) => n != null)).size,
      de: demoras[0]?.hora ?? null,
      ate: demoras[demoras.length - 1]?.hora ?? null,
    },
    mesasQueDesistiram: desistRows
      .map((d) => ({ numero: num(d.numero), cancelado: num(d.cancelado), pago: d.pago == null ? null : num(d.pago), hora: d.hora }))
      .filter((d) => d.pago != null && d.cancelado > d.pago)
      .sort((a, b) => b.cancelado - a.cancelado),
    maiores: [...cancRows]
      .sort((a, b) => num(b.valor) - num(a.valor))
      .slice(0, 5)
      .map((c) => ({
        hora: c.hora,
        lancado: c.lancado ?? null,
        numero: c.numero,
        nome: c.nome ?? '?',
        valor: num(c.valor),
        motivo: (c.motivo ?? '').trim() || 'Sem motivo',
        quem: c.login ?? c.gerente ?? null,
      })),
  };

  // --- Avaliações, reservas, quedas ------------------------------------------------
  const avaliacoes = {
    total: avalRows.length,
    media: avalRows.length ? avalRows.reduce((s, a) => s + num(a.nota), 0) / avalRows.length : null,
    baixas: avalRows
      .filter((a) => num(a.nota) <= 3)
      .map((a) => ({ nota: num(a.nota), mesa: a.mesa, hora: a.hora, comentario: a.comentario?.trim() || null })),
  };
  const rsv = (st: string) => reservaRows.filter((r) => r.status === st).reduce((s, r) => s + num(r.n), 0);
  const reservas = {
    total: reservaRows.reduce((s, r) => s + num(r.n), 0) - rsv('cancelada'),
    pessoas: reservaRows.filter((r) => r.status !== 'cancelada').reduce((s, r) => s + num(r.pessoas), 0),
    sentadas: rsv('sentada'),
    noShow: rsv('no_show'),
    canceladas: rsv('cancelada'),
  };
  const quedas = quedaRows.map((k) => ({ hora: k.hora, minutos: Math.max(1, Math.round(num(k.segundos) / 60)) }));
  const descontos = descRows.map((d) => ({ numero: d.numero, desconto: num(d.desconto), pago: num(d.pago) }));
  const jornadasLongas = pessoas
    .filter((p) => (p.minutos ?? 0) >= 660)
    .map((p) => ({ nome: p.nome, minutos: p.minutos ?? 0 }))
    .sort((a, b) => b.minutos - a.minutos);

  const semanaPassada = { contas: num(r0?.contas_sp), total: num(r0?.total_sp) };
  const temMovimento = movimento.contas > 0 || pessoas.length > 0 || cancRows.length > 0;

  // --- Pontos de atenção -----------------------------------------------------------
  const atencao: string[] = [];
  const d = cancelamentos.demora;
  if (d.itens > 0) {
    atencao.push(
      `${d.itens} ${d.itens === 1 ? 'item cancelado' : 'itens cancelados'} por demora no preparo (${reais(d.valor)}) em ${d.mesas} ${d.mesas === 1 ? 'mesa' : 'mesas'}` +
        (d.de && d.ate && d.de !== d.ate ? `, entre ${d.de} e ${d.ate}` : d.de ? `, às ${d.de}` : ''),
    );
  }
  if (cancelamentos.mesasQueDesistiram.length) {
    const lista = cancelamentos.mesasQueDesistiram
      .slice(0, 4)
      .map((m) => `${m.numero} (cancelou ${reais(m.cancelado, false)}, pagou ${reais(m.pago ?? 0, false)})`)
      .join(', ');
    atencao.push(
      `${cancelamentos.mesasQueDesistiram.length > 1 ? 'Mesas que foram embora' : 'Mesa que foi embora'} sem o pedido: ${lista}`,
    );
  }
  for (const per of periodos) {
    if (per.pico < 12) continue;
    const mesasPorGarcom = per.garconsNoPico ? per.pico / per.garconsNoPico : null;
    const poucoGarcom = mesasPorGarcom != null && mesasPorGarcom > 6;
    const poucaCozinha = per.cozinhaNoPico > 0 && per.pico / per.cozinhaNoPico > 10;
    if (poucoGarcom || poucaCozinha) {
      atencao.push(
        `${per.nome}: pico de ${per.pico} mesas às ${per.picoHora} com ${pl(per.garconsNoPico, 'garçom', 'garçons')} e ${per.cozinhaNoPico} na cozinha no ponto`,
      );
    }
  }
  const falta = porMotivo.find((m) => /falta/i.test(m.motivo));
  if (falta && falta.itens >= 3) {
    atencao.push(`${pl(falta.itens, 'item cancelado', 'itens cancelados')} por produto em falta (${reais(falta.valor)})`);
  }
  for (const a of avaliacoes.baixas.slice(0, 3)) {
    atencao.push(
      `Avaliação nota ${a.nota}${a.mesa != null ? ` na mesa ${a.mesa}` : ''} às ${a.hora}${a.comentario ? `: "${a.comentario.slice(0, 140)}"` : ''}`,
    );
  }
  const atrasados = pracas.reduce((s, p) => s + p.acimaDaMeta, 0);
  if (kds.cobertura >= 0.5 && atrasados > 0) {
    atencao.push(`${atrasados} de ${kds.medidos} itens saíram acima da meta de tempo da praça`);
  }
  for (const c of descontos.filter((x) => x.pago <= x.desconto * 0.1).slice(0, 2)) {
    atencao.push(`Mesa/comanda ${c.numero ?? '?'} fechou zerada: ${reais(c.desconto)} de desconto`);
  }
  if (semanaPassada.total > 500 && movimento.total < semanaPassada.total * 0.7) {
    const queda = Math.round((1 - movimento.total / semanaPassada.total) * 100);
    atencao.push(`Faturamento ${queda}% abaixo do mesmo dia da semana passada (${reais(semanaPassada.total, false)})`);
  }
  const recebidoDasContas = recebido - recebidoSemConta;
  if (Math.abs(recebidoDasContas - movimento.total) >= 50 && movimento.contas > 0) {
    const dif = recebidoDasContas - movimento.total;
    atencao.push(`Recebido no caixa ${reais(recebidoDasContas)}: ${reais(Math.abs(dif))} ${dif > 0 ? 'a mais' : 'a menos'} que o total das contas`);
  }
  if (recebidoSemConta >= 0.01) {
    atencao.push(`${reais(recebidoSemConta)} de baixa de fiado/permuta lançada no dia — não é venda de hoje e ficou fora da comparação acima`);
  }
  if (jornadasLongas.length) {
    atencao.push(
      `Jornada acima de 11 h: ${jornadasLongas
        .slice(0, 5)
        .map((j) => `${j.nome.split(' ')[0]} (${horas(j.minutos)})`)
        .join(', ')}`,
    );
  }
  const totalQueda = quedas.reduce((s, k) => s + k.minutos, 0);
  if (totalQueda >= 5) {
    atencao.push(`Servidor da loja ficou fora ${totalQueda} min (${quedas.length} ${quedas.length === 1 ? 'queda' : 'quedas'}, a primeira às ${quedas[0].hora})`);
  }

  return {
    filialId: filial.id,
    nome: filial.nome,
    dia,
    ativa: !!r0?.ativa,
    temMovimento,
    movimento,
    semanaPassada,
    periodos,
    porHora,
    pagamentos,
    recebido,
    pracas,
    top: topRows.map((t) => ({ nome: t.nome, qtd: num(t.qtd), valor: num(t.valor) })),
    equipe: {
      total: pessoas.length,
      funcoes,
      semCargo: pessoas.filter((p) => p.chave === 'salaosemcargo' || p.chave === 'outros').length,
    },
    cancelamentos,
    kds,
    avaliacoes,
    reservas,
    listaEspera: num(esperaRows[0]?.n),
    quedas,
    descontos,
    jornadasLongas,
    caixa: null,
    atencao,
  };
}

/** Metas de tempo do KDS direto da loja (`/api/tempos`, sem login). Falhou → padrão. */
async function metasDaLoja(caixaUrl: string | null): Promise<MetasKds> {
  const padrao: MetasKds = { padrao: 15, porPraca: {} };
  if (!caixaUrl) return padrao;
  try {
    const resp = await fetch(`${caixaUrl.replace(/\/+$/, '')}/api/tempos`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return padrao;
    const j = (await resp.json()) as { padrao?: number; areas?: Array<{ codigo?: number; minutos?: number | null }> };
    const metas: MetasKds = { padrao: num(j.padrao) || 15, porPraca: {} };
    for (const a of j.areas ?? []) {
      if (a.codigo != null && a.minutos != null && num(a.minutos) > 0) metas.porPraca[a.codigo] = num(a.minutos);
    }
    return metas;
  } catch {
    return padrao;
  }
}

// ---------------------------------------------------------------------------
// Caixa do dia: gavetas, saídas de dinheiro e maquininhas sem fechar
// ---------------------------------------------------------------------------
// A nuvem não recebe mais caixa nem sangria desde o corte do Consumer
// (07/09/2026): `caixa`/`caixa_operacao` pararam ali. A fonte é a loja, pelo
// canal assinado da Conferência de Caixa — só LEITURA (/relatorio e /conferir).
// Loja fora do ar não derruba o relatório: sai `caixa.ok = false` e o resto igual.
//
// O "dia" de /relatorio?data= é o dia do relógio do banco da loja, e cada loja
// está num fuso (Bar −03, Tabuará +00, Mar −07). Por isso lê D−1, D e D+1 e
// recorta pelo INSTANTE, na janela 05:00 → 05:00 BRT: cada saída aparece no
// relatório de um dia só, o dia em que o dinheiro saiu.

/** A leitura do caixa não pode segurar o relatório (cron e webhook têm 60 s). */
const PRAZO_CAIXA_MS = 9000;

interface CxLoja {
  codigo: number;
  quem?: string | null;
  aberto_em?: string | null;
  fechado_em?: string | null;
  fundo?: number | null;
  esperado?: number | null;
  contado?: number | null;
  tipo?: string | null;
  formas?: Array<{ codigo?: number; valor?: number }>;
}
interface MovLoja {
  caixa: number;
  quando?: string | null;
  entrada?: number | null;
  saida?: number | null;
  obs?: string | null;
}
interface ConfLoja {
  codigo: number;
  quem?: string | null;
  tipo?: string | null;
  aberto_em?: string | null;
  pagamentos?: number;
  total?: number;
  fecharia?: boolean;
  categoria?: string | null;
  motivo?: string | null;
  canal?: { n?: number; total?: number } | null;
}

/** Forma "Dinheiro" no vendas-local. */
const FORMA_DINHEIRO = 1;

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Instante vindo da loja: ISO ("…Z") ou texto do Postgres, que vem com o fuso
 *  DA LOJA ("2026-10-01 08:45:05.628072-07", "2026-09-02 16:36:19.121+00"). */
function instanteDaLoja(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(s);
  let d: Date;
  if (m) {
    const hora = m[2].length === 5 ? `${m[2]}:00` : m[2];
    const ms = m[3] ? `.${m[3].slice(0, 3).padEnd(3, '0')}` : '';
    let fuso = m[4] ?? '-03:00';
    if (fuso !== 'Z') {
      const f = /^([+-]\d{2}):?(\d{2})?$/.exec(fuso);
      fuso = f ? `${f[1]}:${f[2] ?? '00'}` : '-03:00';
    }
    d = new Date(`${m[1]}T${hora}${ms}${fuso}`);
  } else {
    d = new Date(s);
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "15:10" em BRT. */
function horaBr(d: Date): string {
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);
}

/** "08/10" em BRT. */
function diaMesBr(d: Date): string {
  const y = dateToBrYmd(d);
  return `${y.slice(8, 10)}/${y.slice(5, 7)}`;
}

/** A observação do lançamento na gaveta é montada pela loja assim:
 *  sangria  → "levou: <quem levou> · <motivo> · <quem lançou>"
 *  despesa / suprimento → "<motivo> · <quem lançou>" */
function lerObsGaveta(obs: string | null | undefined): { levou: string | null; motivo: string; lancou: string | null } {
  const partes = String(obs ?? '')
    .split(' · ')
    .map((x) => x.trim())
    .filter(Boolean);
  let levou: string | null = null;
  if (partes.length && /^levou:/i.test(partes[0])) {
    levou = (partes.shift() ?? '').replace(/^levou:\s*/i, '').trim() || null;
  }
  const lancou = partes.length > 1 ? (partes.pop() ?? null) : null;
  return { levou, motivo: partes.join(' · ') || 'sem motivo', lancou };
}

/** Chave pra somar por pessoa: o nome é digitado no balcão ("Cintia", "cíntia "). */
function chaveNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function caixaSemResposta(erro: string): CaixaDia {
  return {
    ok: false,
    erro,
    gavetas: [],
    saidas: [],
    entradas: [],
    totalSaidas: 0,
    totalEntradas: 0,
    porPessoa: [],
    maquininhas: null,
  };
}

/** Centavos de troco arredondado na abertura não viram alerta. */
const FOLGA_PASSAGEM = 1;
/** Quem entra costuma abrir o caixa antes de quem sai fechar o dele. */
const FOLGA_TROCA_MS = 2 * 3600 * 1000;

export interface CaixaNaFila {
  codigo: number;
  quem: string;
  aberto: Date;
  fechado: Date | null;
  fundo: number;
  /** saldo do fechamento (contado; sem contagem, o esperado) */
  saldo: number | null;
}

/**
 * Passagem de caixa: pra cada gaveta que abriu com fundo, acha o fechamento
 * anterior que esse fundo deveria repetir. Cada fechamento serve a UMA abertura.
 * Com mais de um fechamento esperando (a casa teve dois caixas), vale o que
 * mais se aproxima do fundo — um deles sozinho ou a soma de todos (a Prainha
 * Mar juntou dois caixas numa gaveta em 06/10). Gaveta que abre zerada é caixa
 * de apoio: não compara nem gasta o fechamento de ninguém.
 */
export function passagensDeGaveta(
  lista: CaixaNaFila[],
): Map<number, { de: string; fechou: Date; saldo: number; diferenca: number }> {
  const out = new Map<number, { de: string; fechou: Date; saldo: number; diferenca: number }>();
  const usados = new Set<number>();
  const fila = [...lista].sort((a, b) => a.aberto.getTime() - b.aberto.getTime() || a.codigo - b.codigo);
  for (const o of fila) {
    if (o.fundo < 0.01) continue;
    const ab = o.aberto.getTime();
    const espera = fila
      .filter(
        (c) =>
          c.codigo !== o.codigo &&
          !usados.has(c.codigo) &&
          c.fechado != null &&
          c.saldo != null &&
          c.saldo >= 0.01 &&
          c.aberto.getTime() < ab &&
          c.fechado.getTime() <= ab + FOLGA_TROCA_MS,
      )
      .sort((a, b) => (b.fechado as Date).getTime() - (a.fechado as Date).getTime());
    if (!espera.length) continue;
    // O mais recente ganha o empate.
    let melhor: CaixaNaFila[] = [espera[0]];
    let dist = Math.abs(o.fundo - (espera[0].saldo as number));
    for (const c of espera.slice(1)) {
      const d = Math.abs(o.fundo - (c.saldo as number));
      if (d < dist - 0.005) {
        melhor = [c];
        dist = d;
      }
    }
    if (espera.length > 1) {
      const soma = espera.reduce((t, c) => t + (c.saldo as number), 0);
      if (Math.abs(o.fundo - soma) < dist - 0.005) melhor = espera;
    }
    const saldo = r2(melhor.reduce((t, c) => t + (c.saldo as number), 0));
    for (const c of melhor) usados.add(c.codigo);
    const nomes = [...new Set(melhor.map((c) => c.quem))];
    out.set(o.codigo, {
      de: nomes.join(' + '),
      fechou: melhor[0].fechado as Date,
      saldo,
      diferenca: r2(o.fundo - saldo),
    });
  }
  return out;
}

/** Gavetas, saídas de dinheiro e maquininhas abertas da casa no dia. Nunca lança. */
async function caixaDaLoja(filialId: string, dia: string): Promise<CaixaDia> {
  try {
    const leitura = Promise.all([
      chamarLojaCaixa(filialId, `/relatorio?data=${somaDias(dia, -1)}`),
      chamarLojaCaixa(filialId, `/relatorio?data=${dia}`),
      chamarLojaCaixa(filialId, `/relatorio?data=${somaDias(dia, 1)}`),
      chamarLojaCaixa(filialId, '/conferir'),
    ]);
    // Só pra passagem de caixa: o fechamento anterior pode ser de 2 ou 3 dias
    // atrás (casa que não abriu na véspera). Se não vier, o resto sai igual.
    const leituraAntes = Promise.all([
      chamarLojaCaixa(filialId, `/relatorio?data=${somaDias(dia, -3)}`),
      chamarLojaCaixa(filialId, `/relatorio?data=${somaDias(dia, -2)}`),
    ]).catch(() => null);
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const prazo = new Promise<null>((res) => {
      relogio = setTimeout(() => res(null), PRAZO_CAIXA_MS);
    });
    const lido = await Promise.race([leitura, prazo]);
    const lidoAntes = lido ? await Promise.race([leituraAntes, prazo]) : null;
    clearTimeout(relogio);
    if (!lido) return caixaSemResposta('a loja não respondeu a tempo');
    const [antes, noDia, depois, conf] = lido;
    const dias = [antes, noDia, depois];
    const falhou = dias.find((x) => !x.ok);
    if (falhou) return caixaSemResposta(String(falhou.erro || 'a loja não respondeu'));

    const iniMs = new Date(`${dia}T05:00:00-03:00`).getTime();
    const fimMs = new Date(`${somaDias(dia, 1)}T05:00:00-03:00`).getTime();
    const agoraMs = Date.now();
    // O trecho que as 3 leituras cobrem com certeza, seja qual for o fuso da loja.
    const cobreDe = new Date(`${somaDias(dia, -1)}T12:00:00Z`).getTime();
    const cobreAte = new Date(`${somaDias(dia, 2)}T00:00:00Z`).getTime();

    // O estado do caixa (fundo, esperado, contado, fechado) é o de AGORA em
    // qualquer um dos dias; o recebido por forma é só do dia pedido → soma.
    interface Acum {
      codigo: number;
      quem: string;
      tipo: string;
      aberto: Date | null;
      fechado: Date | null;
      fundo: number;
      esperado: number | null;
      contado: number | null;
      dinheiro: number;
      entradas: number;
      saidas: number;
    }
    const cxs = new Map<number, Acum>();
    const movs = new Map<string, MovLoja>();
    for (const d of dias) {
      for (const c of (Array.isArray(d.caixas) ? d.caixas : []) as CxLoja[]) {
        const cod = Number(c.codigo);
        if (!Number.isFinite(cod)) continue;
        const a: Acum = cxs.get(cod) ?? {
          codigo: cod,
          quem: '',
          tipo: 'sistema',
          aberto: null,
          fechado: null,
          fundo: 0,
          esperado: null,
          contado: null,
          dinheiro: 0,
          entradas: 0,
          saidas: 0,
        };
        a.quem = String(c.quem ?? '').trim() || a.quem;
        a.tipo = String(c.tipo ?? a.tipo);
        a.aberto = instanteDaLoja(c.aberto_em) ?? a.aberto;
        a.fechado = instanteDaLoja(c.fechado_em);
        a.fundo = num(c.fundo);
        a.esperado = c.esperado == null ? null : num(c.esperado);
        a.contado = c.contado == null ? null : num(c.contado);
        for (const f of c.formas ?? []) {
          if (Number(f.codigo) === FORMA_DINHEIRO) a.dinheiro += num(f.valor);
        }
        cxs.set(cod, a);
      }
      for (const m of (Array.isArray(d.movs) ? d.movs : []) as MovLoja[]) {
        movs.set([m.caixa, m.quando, m.entrada, m.saida, m.obs].join('|'), m);
      }
    }

    const saidas: MovGaveta[] = [];
    const entradas: MovGaveta[] = [];
    const ordem = new Map<MovGaveta, number>();
    for (const m of movs.values()) {
      const quando = instanteDaLoja(m.quando);
      const cx = cxs.get(Number(m.caixa));
      const entra = num(m.entrada);
      const sai = num(m.saida);
      if (cx) {
        cx.entradas += entra;
        cx.saidas += sai;
      }
      if (!quando) continue;
      const t = quando.getTime();
      if (t < iniMs || t >= fimMs) continue;
      const obs = lerObsGaveta(m.obs);
      const base = {
        hora: horaBr(quando),
        diaMes: diaMesBr(quando),
        caixa: Number(m.caixa),
        caixaDe: cx?.quem || `caixa ${m.caixa}`,
        ...obs,
      };
      if (sai > 0) {
        const linha = { ...base, valor: r2(sai) };
        saidas.push(linha);
        ordem.set(linha, t);
      }
      if (entra > 0) {
        const linha = { ...base, valor: r2(entra) };
        entradas.push(linha);
        ordem.set(linha, t);
      }
    }
    const porHora = (a: MovGaveta, b: MovGaveta) => (ordem.get(a) ?? 0) - (ordem.get(b) ?? 0);
    saidas.sort(porHora);
    entradas.sort(porHora);

    const pessoas = new Map<string, { nome: string; valor: number; n: number }>();
    for (const x of saidas) {
      // Despesa paga no balcão não tem "quem levou": a loja só pede o nome na sangria.
      const nome = x.levou ?? 'despesa paga no caixa';
      const k = chaveNome(nome);
      const p = pessoas.get(k) ?? { nome, valor: 0, n: 0 };
      p.valor = r2(p.valor + x.valor);
      p.n += 1;
      pessoas.set(k, p);
    }

    const rotulo = (d: Date) => `${diaMesBr(d)} ${horaBr(d)}`;

    // Passagem de caixa: a fila de gavetas do trecho lido (até 3 dias antes).
    const filaCx = new Map<number, CaixaNaFila>();
    for (const d of lidoAntes ?? []) {
      if (!d?.ok) continue;
      for (const c of (Array.isArray(d.caixas) ? d.caixas : []) as CxLoja[]) {
        const cod = Number(c.codigo);
        const aberto = instanteDaLoja(c.aberto_em);
        if (!Number.isFinite(cod) || !aberto || String(c.tipo ?? '') === 'maquininha') continue;
        const saldo = c.contado != null ? num(c.contado) : c.esperado != null ? num(c.esperado) : null;
        filaCx.set(cod, {
          codigo: cod,
          quem: String(c.quem ?? '').trim() || `caixa ${cod}`,
          aberto,
          fechado: instanteDaLoja(c.fechado_em),
          fundo: num(c.fundo),
          saldo,
        });
      }
    }
    for (const c of cxs.values()) {
      if (c.tipo === 'maquininha' || c.aberto == null) continue;
      filaCx.set(c.codigo, {
        codigo: c.codigo,
        quem: c.quem || `caixa ${c.codigo}`,
        aberto: c.aberto,
        fechado: c.fechado,
        fundo: c.fundo,
        saldo: c.contado ?? c.esperado,
      });
    }
    const passagens = passagensDeGaveta([...filaCx.values()]);

    const gavetas: GavetaDia[] = [...cxs.values()]
      .filter((c) => c.tipo !== 'maquininha' && c.aberto != null)
      .filter((c) => {
        const ab = (c.aberto as Date).getTime();
        return ab < fimMs && (c.fechado == null || c.fechado.getTime() >= iniMs);
      })
      .sort((a, b) => (a.aberto as Date).getTime() - (b.aberto as Date).getTime())
      .map((c) => {
        const ab = (c.aberto as Date).getTime();
        const aberta = c.fechado == null;
        let esperado = c.esperado;
        // Gaveta ainda aberta: a loja só calcula o saldo ao fechar. Dá pra dizer
        // quanto deve ter lá dentro se a leitura pegou o caixa desde a abertura.
        if (aberta && ab >= cobreDe && agoraMs <= cobreAte) {
          esperado = r2(c.fundo + c.dinheiro + c.entradas - c.saidas);
        }
        const contado = aberta ? null : c.contado;
        return {
          codigo: c.codigo,
          quem: c.quem || `caixa ${c.codigo}`,
          abertoEm: rotulo(c.aberto as Date),
          fechadoEm: c.fechado ? rotulo(c.fechado) : null,
          aberta,
          doDia: ab >= iniMs,
          diasAberta: aberta ? Math.floor((agoraMs - ab) / DIA_MS) : 0,
          fundo: r2(c.fundo),
          dinheiro: r2(c.dinheiro),
          entradas: r2(c.entradas),
          saidas: r2(c.saidas),
          esperado,
          contado,
          diferenca: !aberta && esperado != null && contado != null ? r2(contado - esperado) : null,
          passagem: (() => {
            const p = passagens.get(c.codigo);
            return p ? { de: p.de, fechouEm: rotulo(p.fechou), saldo: p.saldo, diferenca: p.diferenca } : null;
          })(),
        };
      });

    // Maquininhas: a conferência diz como está AGORA (não tem histórico). Entra
    // o que abriu até o fim do dia do relatório e continua aberto.
    let maquininhas: MaquininhaAberta[] | null = null;
    if (conf.ok && Array.isArray(conf.caixas)) {
      const passageiras = ['extrato_atrasado', 'extrato_indisponivel', 'erro_banco'];
      maquininhas = (conf.caixas as ConfLoja[])
        .filter((c) => c.tipo === 'maquininha')
        .map((c) => ({ c, aberto: instanteDaLoja(c.aberto_em) }))
        .filter((x): x is { c: ConfLoja; aberto: Date } => x.aberto != null && x.aberto.getTime() < fimMs)
        .sort((a, b) => a.aberto.getTime() - b.aberto.getTime())
        .map(({ c, aberto }) => {
          const fecharia = c.fecharia === true;
          const categoria = c.categoria ?? null;
          return {
            codigo: Number(c.codigo),
            quem: cxs.get(Number(c.codigo))?.quem || String(c.quem ?? '').trim() || `caixa ${c.codigo}`,
            desde: rotulo(aberto),
            dias: Math.floor((agoraMs - aberto.getTime()) / DIA_MS),
            pagamentos: num(c.pagamentos),
            total: r2(num(c.total)),
            fecharia,
            categoria,
            motivo: c.motivo
              ? String(c.motivo).replace(' (vai até 00/00/0000)', ' (a nuvem ainda não tem extrato da Cielo desta casa)')
              : null,
            canal: r2(num(c.canal?.total)),
            // Extrato do próprio dia que ainda não chegou é passageiro; o resto
            // (dinheiro lançado, sem par, duplicado, ou caixa de dias atrás) é trava.
            travada: !fecharia && (!passageiras.includes(categoria ?? '') || aberto.getTime() < iniMs),
          };
        });
    }

    return {
      ok: true,
      erro: null,
      gavetas,
      saidas,
      entradas,
      totalSaidas: r2(saidas.reduce((s, x) => s + x.valor, 0)),
      totalEntradas: r2(entradas.reduce((s, x) => s + x.valor, 0)),
      porPessoa: [...pessoas.values()].sort((a, b) => b.valor - a.valor),
      maquininhas,
    };
  } catch (e) {
    return caixaSemResposta(e instanceof Error ? e.message : 'falha ao ler o caixa da loja');
  }
}

/** O que do caixa vira ponto de atenção do dia. */
function atencaoDoCaixa(cx: CaixaDia): string[] {
  const out: string[] = [];
  if (!cx.ok) return out;
  for (const g of cx.gavetas) {
    if (g.diferenca != null && Math.abs(g.diferenca) >= 1) {
      out.push(
        `Gaveta de ${g.quem} fechou com ${reais(Math.abs(g.diferenca))} ${g.diferenca < 0 ? 'a menos' : 'a mais'} que o esperado (esperado ${reais(g.esperado ?? 0)}, contado ${reais(g.contado ?? 0)})`,
      );
    }
    // Dinheiro: o caixa que abre tem que abrir com o saldo do que fechou.
    const p = g.passagem;
    if (g.doDia && p && Math.abs(p.diferenca) >= FOLGA_PASSAGEM) {
      out.push(
        `Gaveta de ${g.quem} abriu (${g.abertoEm}) com ${reais(g.fundo)}, mas o caixa anterior (${p.de}) fechou ${p.fechouEm} com ${reais(p.saldo)} — ` +
          (p.diferenca < 0
            ? `${reais(Math.abs(p.diferenca))} a menos, sem saída registrada`
            : `${reais(p.diferenca)} a mais, sem entrada registrada`),
      );
    }
    if (g.aberta && g.diasAberta >= 2) {
      out.push(`Gaveta de ${g.quem} aberta desde ${g.abertoEm.slice(0, 5)} (${g.diasAberta} dias) — ninguém fechou`);
    }
  }
  const travadas = (cx.maquininhas ?? []).filter((m) => m.travada);
  if (travadas.length) {
    const lista = travadas
      .slice(0, 5)
      .map((m) => `${m.quem} desde ${m.desde.slice(0, 5)} (${reais(m.total)})`)
      .join(', ');
    const mesmoMotivo = travadas.every((m) => m.categoria === travadas[0].categoria);
    const semExtrato = travadas.every((m) => (m.motivo ?? '').includes('a nuvem ainda não tem extrato'));
    const curto: Record<string, string> = {
      extrato_atrasado: 'o extrato da Cielo desses dias ainda não chegou',
      extrato_indisponivel: 'a loja não conseguiu ler o extrato da Cielo',
      dinheiro_lancado: 'tem dinheiro lançado em caixa de maquininha',
      sem_par: 'tem cartão ou Pix sem par na Cielo',
      duplicado: 'tem pagamento lançado em dobro',
      erro_banco: 'a conferência deu erro na loja',
    };
    const porque = semExtrato
      ? 'a nuvem não tem extrato da Cielo desta casa, então a conferência não fecha nenhum'
      : mesmoMotivo
        ? (curto[travadas[0].categoria ?? ''] ?? travadas[0].motivo ?? 'não conferem')
        : 'motivos em Financeiro › Conferência de caixa';
    out.push(
      `${pl(travadas.length, 'caixa de maquininha travado', 'caixas de maquininha travados')} sem fechar: ${lista}` +
        (travadas.length > 5 ? ` e mais ${travadas.length - 5}` : '') +
        ` — ${porque}`,
    );
  }
  return out;
}

/** Relatório do dia de todas as casas da organização (só as que estão em operação). */
export async function montarRelatorioOrganizacao(organizacaoId: string, dia: string): Promise<RelatorioCasa[]> {
  const filiais = await q<{ id: string; nome: string; caixa_url: string | null }>(sql`
    SELECT id, nome, caixa_url FROM filial WHERE organizacao_id = ${organizacaoId} ORDER BY cnpj, nome
  `);
  return montarRelatorioFiliais(filiais, dia);
}

export async function montarRelatorioFiliais(
  filiais: Array<{ id: string; nome: string; caixa_url?: string | null }>,
  dia: string,
): Promise<RelatorioCasa[]> {
  const casas = await Promise.all(
    filiais.map(async (f) => {
      // O caixa vem da loja em paralelo com o resto; casa sem loja ligada fica sem.
      const [casa, caixa] = await Promise.all([
        (async () => montarRelatorioCasa(f, dia, await metasDaLoja(f.caixa_url ?? null)))(),
        f.caixa_url?.trim() ? caixaDaLoja(f.id, dia) : Promise.resolve(null),
      ]);
      if (caixa) {
        casa.caixa = caixa;
        casa.atencao.push(...atencaoDoCaixa(caixa));
      }
      return casa;
    }),
  );
  return casas.filter((c) => c.ativa || c.temMovimento);
}

// ---------------------------------------------------------------------------
// Texto (WhatsApp)
// ---------------------------------------------------------------------------

/** Uma linha, sem quebra — vai na variável do modelo da Meta. */
export function resumoUmaLinha(casas: RelatorioCasa[]): string {
  const total = casas.reduce((s, c) => s + c.movimento.total, 0);
  const partes = casas.map((c) =>
    c.movimento.contas
      ? `${c.nome} ${reais(c.movimento.total, false)} (${pl(c.movimento.contas, 'conta', 'contas')})`
      : `${c.nome} sem movimento`,
  );
  return `${partes.join(' · ')} · Total ${reais(total, false)}`;
}

/** Gaveta, saídas de dinheiro e maquininhas sem fechar, pro texto do WhatsApp. */
function linhasCaixa(c: RelatorioCasa): string[] {
  const cx = c.caixa;
  if (!cx) return [];
  if (!cx.ok) return ['💵 Caixa: a loja não respondeu na hora do relatório — gaveta e saídas ficam na tela.'];
  const L: string[] = [];
  // Gaveta do dia: a que abriu ou a que fechou nele. A esquecida aberta vai em Atenção.
  for (const g of cx.gavetas.filter((x) => x.doDia || !x.aberta)) {
    let fim: string;
    if (g.aberta) {
      fim = g.esperado != null ? `ainda aberta, deve ter ${reais(g.esperado)}` : 'ainda aberta';
    } else if (g.contado == null) {
      fim = 'fechou sem contagem';
    } else if (g.diferenca == null || Math.abs(g.diferenca) < 0.01) {
      fim = `fechou com ${reais(g.contado)} — bateu`;
    } else {
      fim = `fechou com ${reais(g.contado)} — ${reais(Math.abs(g.diferenca))} ${g.diferenca < 0 ? 'a menos' : 'a mais'} que o esperado`;
    }
    const conta =
      `fundo ${reais(g.fundo)} + dinheiro ${reais(g.dinheiro)}` +
      (g.entradas ? ` + entradas ${reais(g.entradas)}` : '') +
      (g.saidas ? ` − saídas ${reais(g.saidas)}` : '');
    L.push(`💵 Gaveta de ${g.quem}${g.doDia ? '' : ` (aberta em ${g.abertoEm.slice(0, 5)})`}: ${conta} · ${fim}`);
    const p = g.passagem;
    if (g.doDia && p) {
      L.push(
        Math.abs(p.diferenca) < FOLGA_PASSAGEM
          ? `   ↪ abriu com o mesmo saldo do caixa anterior (${p.de}, ${reais(p.saldo)})`
          : `   ⚠️ abriu com ${reais(Math.abs(p.diferenca))} ${p.diferenca < 0 ? 'a menos' : 'a mais'} que o caixa anterior (${p.de} fechou ${p.fechouEm} com ${reais(p.saldo)})`,
      );
    }
  }
  const linha = (x: MovGaveta) =>
    `• ${x.hora} ${reais(x.valor)} — ${x.levou ? `${x.levou}: ` : ''}${x.motivo}${x.lancou ? ` (lançou ${x.lancou})` : ''}`;
  if (cx.saidas.length) {
    const quem = cx.porPessoa.map((p) => `${p.nome} ${reais(p.valor)}`).join(', ');
    L.push(`💸 Saídas de dinheiro: ${reais(cx.totalSaidas)} em ${cx.saidas.length} — ${quem}`);
    for (const x of cx.saidas.slice(0, 12)) L.push(linha(x));
    if (cx.saidas.length > 12) L.push(`• e mais ${cx.saidas.length - 12} na tela`);
  } else if (cx.gavetas.length) {
    L.push('💸 Nenhuma saída de dinheiro da gaveta.');
  }
  if (cx.entradas.length) {
    L.push(`➕ Entradas na gaveta: ${reais(cx.totalEntradas)} em ${cx.entradas.length}`);
    for (const x of cx.entradas.slice(0, 5)) L.push(linha(x));
  }
  const maq = cx.maquininhas ?? [];
  if (maq.length) {
    const sozinhas = maq.filter((m) => m.fecharia).length;
    const travadas = maq.filter((m) => m.travada).length;
    const esperando = maq.length - sozinhas - travadas;
    const partes = [
      sozinhas ? `${sozinhas} ${sozinhas === 1 ? 'fecha sozinha' : 'fecham sozinhas'} na madrugada` : '',
      esperando ? `${esperando} esperando o extrato da Cielo` : '',
      travadas ? `${travadas} ${travadas === 1 ? 'travada' : 'travadas'}` : '',
    ].filter(Boolean);
    L.push(`🔓 ${pl(maq.length, 'maquininha aberta', 'maquininhas abertas')} agora: ${partes.join(', ')}`);
  }
  return L;
}

function textoCasa(c: RelatorioCasa): string {
  const L: string[] = [];
  L.push(`*${c.nome}*`);
  if (!c.movimento.contas) {
    L.push(c.equipe.total ? `Sem contas no dia (${c.equipe.total} pessoas bateram ponto).` : 'Sem movimento no dia.');
    // Casa sem conta no dia também pode ter gaveta aberta, saída de dinheiro ou maquininha parada.
    const cx = c.caixa;
    if (cx?.ok && (cx.gavetas.length || cx.saidas.length || cx.entradas.length || cx.maquininhas?.length)) {
      L.push(...linhasCaixa(c));
      const doCaixa = atencaoDoCaixa(cx);
      if (doCaixa.length) {
        L.push('⚠️ Atenção:');
        for (const a of doCaixa) L.push(`• ${a}`);
      }
    }
    return L.join('\n');
  }
  const m = c.movimento;
  const comp = c.semanaPassada.total > 0 ? ` (semana passada: ${reais(c.semanaPassada.total, false)})` : '';
  L.push(`💰 ${reais(m.total)} · ${pl(m.contas, 'conta', 'contas')} · ticket ${reais(m.ticket)}${comp}`);
  const pers = c.periodos
    .map(
      (p) =>
        `${p.nome} ${pl(p.contas, 'conta', 'contas')} ${reais(p.total, false)}` +
        (p.pico >= 5 ? ` (pico ${p.pico} mesas às ${p.picoHora})` : ''),
    )
    .join(' · ');
  if (pers) L.push(`🕐 ${pers}`);
  if (c.equipe.total) {
    const eq = c.equipe.funcoes.map((f) => equipeEmTexto(f.chave, f.pessoas.length)).join(', ');
    L.push(`👥 No ponto (${c.equipe.total}): ${eq}`);
  }
  const k = c.cancelamentos;
  if (k.itens) {
    L.push(
      `❌ ${pl(k.itens, 'item cancelado', 'itens cancelados')} (${reais(k.valor)})` +
        (k.demora.itens ? ` — ${k.demora.itens} por demora (${reais(k.demora.valor)})` : ''),
    );
  }
  if (c.kds.cobertura >= 0.5) {
    const tempos = c.pracas
      .filter((p) => p.medianaMin != null)
      .map((p) => `${p.nome} ${Math.round(p.medianaMin ?? 0)} min (${p.acimaDaMeta} acima de ${p.metaMin})`)
      .join(' · ');
    if (tempos) L.push(`⏱ Preparo: ${tempos}`);
  }
  if (c.avaliacoes.total) {
    L.push(
      `⭐ ${c.avaliacoes.total} ${c.avaliacoes.total === 1 ? 'avaliação' : 'avaliações'}, média ${(c.avaliacoes.media ?? 0).toFixed(1).replace('.', ',')}` +
        (c.avaliacoes.baixas.length ? ` — ${c.avaliacoes.baixas.length} com nota baixa` : ''),
    );
  }
  if (c.reservas.total) {
    L.push(
      `📅 ${pl(c.reservas.total, 'reserva', 'reservas')}: ${pl(c.reservas.sentadas, 'veio', 'vieram')}, ${pl(c.reservas.noShow, 'faltou', 'faltaram')}`,
    );
  }
  L.push(...linhasCaixa(c));
  if (c.atencao.length) {
    L.push('⚠️ Atenção:');
    for (const a of c.atencao) L.push(`• ${a}`);
  }
  return L.join('\n');
}

/** Mensagens prontas pro WhatsApp (cada uma abaixo do limite de 4096 caracteres). */
export function textoRelatorio(casas: RelatorioCasa[], dia: string, link: string): string[] {
  const total = casas.reduce((s, c) => s + c.movimento.total, 0);
  const contas = casas.reduce((s, c) => s + c.movimento.contas, 0);
  const cabecalho = `📊 *Relatório de ${rotuloDia(dia)}*\n${pl(casas.length, 'casa', 'casas')} · ${reais(total)} em ${pl(contas, 'conta', 'contas')}`;
  const blocos = [cabecalho, ...casas.map(textoCasa), `Completo: ${link}`];
  const mensagens: string[] = [];
  let atual = '';
  for (const b of blocos) {
    const bloco = b.length > 3800 ? `${b.slice(0, 3790)}…` : b;
    if (atual && atual.length + bloco.length + 2 > 3800) {
      mensagens.push(atual);
      atual = '';
    }
    atual = atual ? `${atual}\n\n${bloco}` : bloco;
  }
  if (atual) mensagens.push(atual);
  return mensagens;
}
