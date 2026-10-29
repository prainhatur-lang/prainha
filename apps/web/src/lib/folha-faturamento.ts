// Indicador folha ÷ faturamento (29/10/2026). Regra do dono: abaixo de 17% é
// o ideal (verde), de 17% a 20% atenção (amarelo), acima de 20% vermelho.
//
// Só lê. Nada aqui grava. Fontes, todas já usadas em outras telas:
//
// FATURAMENTO do período = vendas do PDV (pedido.valor_total − total_servico),
//   por dia operacional (o dia vira às 05:00, igual ao resumo diário), mais os
//   tickets de evento encerrados (evento_ticket.valor_tickets, igual ao VGV).
//   Os 10% de serviço ficam FORA: vão pra equipe, não são receita da casa.
//
// FOLHA do período = custo da casa com gente:
//   1. Contracheques (registrados): folha do contador da competência
//      (folha_contador_resumo: proventos + FGTS + INSS empresa/RAT/terceiros)
//      + provisão de 13º e férias dos mensalistas (salário × (1/12 + 1/9)).
//      Mês sem folha do contador → estimativa do cadastro com a mesma conta do
//      "Custo de pessoal (CLT)" do fechamento (lib/rh/custo-clt.ts), só pra
//      quem é registrado: mensal = salário; intermitente = R$/hora × horas da
//      folha semanal; + encargos de folha_config + FGTS 8% + 13º + férias.
//   2. Folha semanal (conta_pagar das semanas fechadas): diária, gratificação,
//      premiação, transporte, adicional noturno e pró-labore fixo por dia.
//      Semana que cruza a virada do mês entra pelos dias que caem no mês.
//      Comissão e pró-labore "1pp dos 10%" ficam FORA (saem dos 10%, que já
//      não estão no faturamento) — aparecem só como informação.
//   3. Vale-transporte quinzenal pago (vt_quinzena_item.valor_pago).
//
// Mês corrente: vai até o último dia com folha semanal fechada (ou ontem, o
// que vier antes), e faturamento e folha usam o MESMO período. Salário mensal
// e contracheque entram proporcionais aos dias.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { dateToBrYmd } from '@/lib/datas';

export const FAIXA_VERDE_ATE = 17;
export const FAIXA_AMARELO_ATE = 20;
/** Abaixo disso a casa estava fechada/abrindo — % não faz sentido. */
export const FATURAMENTO_MINIMO = 10_000;

const FGTS_PCT = 0.08;

export type Faixa = 'verde' | 'amarelo' | 'vermelho';

export function faixaDoPct(pct: number | null): Faixa | null {
  if (pct == null) return null;
  if (pct < FAIXA_VERDE_ATE) return 'verde';
  if (pct <= FAIXA_AMARELO_ATE) return 'amarelo';
  return 'vermelho';
}

export interface FolhaFaturamentoMes {
  filialId: string;
  mes: string; // 'YYYY-MM'
  ini: string; // 'YYYY-MM-DD'
  fim: string; // 'YYYY-MM-DD' (último dia contado)
  parcial: boolean;
  diasNoPeriodo: number;
  diasNoMes: number;
  /** Último dia coberto por folha semanal fechada da casa (qualquer mês). */
  folhaSemanalAte: string | null;
  faturamento: {
    pdv: number; // valor_total − total_servico
    eventos: number; // tickets de evento
    total: number;
    servico10: number; // informativo (fora do total)
  };
  folha: {
    contracheque: {
      fonte: 'contador' | 'estimado' | 'nenhum';
      proventos: number; // contador: proventos; estimado: salário/horas
      encargos: number; // FGTS + INSS patronal (contador) | encargos + FGTS (estimado)
      provisao: number; // 13º + férias
      total: number;
      pessoas: number;
    };
    semanal: {
      diaria: number;
      gratificacao: number;
      premiacao: number;
      transporte: number;
      noturno: number;
      proLaboreFixo: number;
      outros: number;
      total: number;
    };
    vt: number;
    total: number;
  };
  /** Pago com os 10% (fora da conta). */
  pagoCom10: { comissao: number; proLabore10: number; total: number };
  pct: number | null;
  faixa: Faixa | null;
  semMovimento: boolean;
  /** Período sem nenhuma semana da folha semanal lançada: diária/comissão
   *  ainda não passavam pelo sistema, então o % sairia baixo demais. */
  semFolhaSemanal: boolean;
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

async function q<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

function somaDias(ymd: string, d: number): string {
  const [a, m, dd] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(a!, m! - 1, dd! + d));
  return t.toISOString().slice(0, 10); // data pura em UTC, sem fuso
}

function diasEntre(ini: string, fim: string): number {
  if (fim < ini) return 0;
  const a = Date.parse(`${ini}T00:00:00Z`);
  const b = Date.parse(`${fim}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Dias de [aIni, aFim] que caem em [bIni, bFim]. */
function sobreposicao(aIni: string, aFim: string, bIni: string, bFim: string): number {
  const i = aIni > bIni ? aIni : bIni;
  const f = aFim < bFim ? aFim : bFim;
  return diasEntre(i, f);
}

/** Último dia operacional fechado (ontem; antes das 05:00 é anteontem). */
function ontemOperacional(agora: Date = new Date()): string {
  return somaDias(dateToBrYmd(new Date(agora.getTime() - 5 * 3600 * 1000)), -1);
}

function ultimoDiaDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
  return `${mes}-${String(d).padStart(2, '0')}`;
}

function tipoSemanal(
  descricao: string | null,
  observacao: string | null,
): keyof FolhaFaturamentoMes['folha']['semanal'] | 'comissao' | 'proLabore10' {
  const d = (descricao ?? '').toLowerCase();
  if (d.startsWith('comiss')) return 'comissao';
  if (d.startsWith('pró-labore') || d.startsWith('pro-labore') || d.startsWith('pró labore')) {
    return /\/dia/i.test(observacao ?? '') ? 'proLaboreFixo' : 'proLabore10';
  }
  if (d.includes('adicional noturno')) return 'noturno';
  if (d.includes('diária') || d.includes('diaria')) return 'diaria';
  if (d.includes('gratifica')) return 'gratificacao';
  if (d.includes('premia')) return 'premiacao';
  if (d.includes('transporte')) return 'transporte';
  return 'outros';
}

/** Último dia coberto por semana da folha semanal já lançada (com conta). */
export async function folhaSemanalFechadaAte(filialId: string): Promise<string | null> {
  const [r] = await q<{ ate: string | null }>(sql`
    SELECT max(fs.data_fim)::text AS ate
      FROM folha_semana fs
     WHERE fs.filial_id = ${filialId}
       AND fs.status <> 'cancelada'
       AND EXISTS (SELECT 1 FROM conta_pagar cp
                    WHERE cp.folha_semana_id = fs.id AND cp.data_delete IS NULL)`);
  return r?.ate ?? null;
}

/** Folha ÷ faturamento de uma casa num mês ('YYYY-MM'). */
export async function calcularFolhaFaturamento(
  filialId: string,
  mes: string,
  opts: { agora?: Date; forcarEstimativa?: boolean } = {},
): Promise<FolhaFaturamentoMes> {
  const ini = `${mes}-01`;
  const fimMes = ultimoDiaDoMes(mes);
  const ontem = ontemOperacional(opts.agora);
  const folhaSemanalAte = await folhaSemanalFechadaAte(filialId);

  let fim = fimMes;
  if (ontem < fim) {
    // mês corrente: corta em ontem, ou antes se a folha semanal não chegou lá
    fim = ontem;
    if (folhaSemanalAte && folhaSemanalAte >= ini && folhaSemanalAte < fim) fim = folhaSemanalAte;
  }
  const parcial = fim < fimMes;
  const diasNoMes = diasEntre(ini, fimMes);
  const diasNoPeriodo = diasEntre(ini, fim);
  const fator = diasNoMes > 0 ? diasNoPeriodo / diasNoMes : 0;

  const vazio: FolhaFaturamentoMes = {
    filialId,
    mes,
    ini,
    fim,
    parcial,
    diasNoPeriodo,
    diasNoMes,
    folhaSemanalAte,
    faturamento: { pdv: 0, eventos: 0, total: 0, servico10: 0 },
    folha: {
      contracheque: { fonte: 'nenhum', proventos: 0, encargos: 0, provisao: 0, total: 0, pessoas: 0 },
      semanal: {
        diaria: 0,
        gratificacao: 0,
        premiacao: 0,
        transporte: 0,
        noturno: 0,
        proLaboreFixo: 0,
        outros: 0,
        total: 0,
      },
      vt: 0,
      total: 0,
    },
    pagoCom10: { comissao: 0, proLabore10: 0, total: 0 },
    pct: null,
    faixa: null,
    semMovimento: true,
    semFolhaSemanal: true,
  };
  if (diasNoPeriodo <= 0) return vazio;

  const tIni = `${ini} 05:00:00-03`;
  const tFim = `${somaDias(fim, 1)} 05:00:00-03`;

  const [vendas, eventos, resumoContador, mensalistasContador, semanal, vt, config] =
    await Promise.all([
      q<{ bruto: string; servico: string }>(sql`
        SELECT coalesce(sum(p.valor_total), 0)::text AS bruto,
               coalesce(sum(p.total_servico), 0)::text AS servico
          FROM pedido p
         WHERE p.filial_id = ${filialId}
           AND p.data_abertura >= ${tIni}::timestamptz
           AND p.data_abertura < ${tFim}::timestamptz
           AND p.data_delete IS NULL`),
      q<{ v: string }>(sql`
        SELECT coalesce(sum(e.valor_tickets), 0)::text AS v
          FROM evento_ticket e
         WHERE e.filial_id = ${filialId}
           AND e.dia >= ${ini}::date AND e.dia <= ${fim}::date
           AND e.status <> 'ABERTO'
           AND coalesce(e.valor_tickets, 0) > 0`),
      q<{ proventos: string; fgts: string; inss: string; empregados: string }>(sql`
        SELECT coalesce(sum(r.proventos), 0)::text AS proventos,
               coalesce(sum(r.fgts + r.fgts_rescisorio), 0)::text AS fgts,
               coalesce(sum(r.inss_empresa + r.inss_rat + r.inss_terceiros), 0)::text AS inss,
               count(*)::text AS linhas,
               (SELECT count(*) FROM folha_contador c
                 WHERE c.filial_id = ${filialId} AND c.competencia = ${mes})::text AS empregados
          FROM folha_contador_resumo r
         WHERE r.filial_id = ${filialId} AND r.competencia = ${mes}
        HAVING count(*) > 0`),
      q<{ salario: string }>(sql`
        SELECT coalesce(sum(least(coalesce(c.salario, c.proventos), c.proventos)), 0)::text AS salario
          FROM folha_contador c
         WHERE c.filial_id = ${filialId} AND c.competencia = ${mes}
           AND c.vinculo = 'Celetista'`),
      q<{ ini: string; fim: string; descricao: string | null; observacao: string | null; valor: string }>(sql`
        SELECT fs.data_inicio::text AS ini, fs.data_fim::text AS fim,
               cp.descricao, cp.observacao, cp.valor::text AS valor
          FROM conta_pagar cp
          JOIN folha_semana fs ON fs.id = cp.folha_semana_id
         WHERE fs.filial_id = ${filialId}
           AND fs.status <> 'cancelada'
           AND cp.data_delete IS NULL
           AND fs.data_fim >= ${ini}::date AND fs.data_inicio <= ${fim}::date`),
      q<{ ini: string; fim: string; v: string }>(sql`
        SELECT q.data_inicio::text AS ini, q.data_fim::text AS fim,
               coalesce(sum(i.valor_pago), 0)::text AS v
          FROM vt_quinzena q
          JOIN vt_quinzena_item i ON i.quinzena_id = q.id
         WHERE q.filial_id = ${filialId}
           AND q.data_fim >= ${ini}::date AND q.data_inicio <= ${fim}::date
         GROUP BY 1, 2`),
      q<{ pct: string | null }>(sql`
        SELECT pct_encargos_clt::text AS pct FROM folha_config WHERE filial_id = ${filialId}`),
    ]);

  // ---- faturamento
  const bruto = n(vendas[0]?.bruto);
  const servico10 = n(vendas[0]?.servico);
  const pdv = bruto - servico10;
  const ev = n(eventos[0]?.v);
  const faturamento = { pdv, eventos: ev, total: pdv + ev, servico10 };

  // ---- contracheques
  const contracheque = { ...vazio.folha.contracheque };
  const provisaoPct = 1 / 12 + 1 / 9; // 13º + férias com 1/3, igual ao custo-clt
  if (resumoContador.length && !opts.forcarEstimativa) {
    const r = resumoContador[0]!;
    contracheque.fonte = 'contador';
    contracheque.proventos = n(r.proventos) * fator;
    contracheque.encargos = (n(r.fgts) + n(r.inss)) * fator;
    contracheque.provisao = n(mensalistasContador[0]?.salario) * provisaoPct * fator;
    contracheque.pessoas = n(r.empregados);
  } else {
    const pctEncargos = n(config[0]?.pct ?? '20') / 100;
    const regs = await q<{
      regime: string;
      salario: string;
      admissao: string | null;
      desligamento: string | null;
      minutos: string;
    }>(sql`
      SELECT fu.regime_salarial AS regime, fu.salario_base::text AS salario,
             fu.data_admissao::text AS admissao, fu.data_desligamento::text AS desligamento,
             coalesce((SELECT sum(h.total_min)
                         FROM folha_horas h
                         JOIN folha_semana fs ON fs.id = h.folha_semana_id
                        WHERE fs.filial_id = ${filialId}
                          AND h.fornecedor_id = fu.fornecedor_id
                          AND h.dia >= ${ini}::date AND h.dia <= ${fim}::date), 0)::text AS minutos
        FROM funcionario fu
       WHERE fu.filial_id = ${filialId}
         AND fu.regime_salarial IS NOT NULL
         AND fu.salario_base IS NOT NULL
         AND (fu.data_admissao IS NULL OR fu.data_admissao <= ${fim}::date)
         AND (fu.data_desligamento IS NULL OR fu.data_desligamento >= ${ini}::date)
         AND (fu.empresa_registro IS NOT NULL OR fu.cnpj_registro IS NOT NULL
              OR fu.matricula_folha IS NOT NULL
              OR EXISTS (SELECT 1 FROM folha_contador c WHERE c.funcionario_id = fu.id))`);
    let base = 0;
    for (const r of regs) {
      if (r.regime === 'intermitente_hora') base += n(r.salario) * (n(r.minutos) / 60);
      else {
        // mensal: proporcional aos dias em que estava na casa dentro do período
        const de = r.admissao && r.admissao > ini ? r.admissao : ini;
        const ate = r.desligamento && r.desligamento < fim ? r.desligamento : fim;
        base += diasNoMes > 0 ? n(r.salario) * (diasEntre(de, ate) / diasNoMes) : 0;
      }
    }
    if (regs.length) contracheque.fonte = 'estimado';
    contracheque.proventos = base;
    contracheque.encargos = base * (pctEncargos + FGTS_PCT);
    contracheque.provisao = base * provisaoPct;
    contracheque.pessoas = regs.length;
  }
  contracheque.total = contracheque.proventos + contracheque.encargos + contracheque.provisao;

  // ---- folha semanal (proporcional aos dias da semana que caem no período)
  const sem = { ...vazio.folha.semanal };
  const pagoCom10 = { comissao: 0, proLabore10: 0, total: 0 };
  for (const r of semanal) {
    const total = diasEntre(r.ini, r.fim);
    if (total <= 0) continue;
    const v = n(r.valor) * (sobreposicao(r.ini, r.fim, ini, fim) / total);
    const t = tipoSemanal(r.descricao, r.observacao);
    if (t === 'comissao') pagoCom10.comissao += v;
    else if (t === 'proLabore10') pagoCom10.proLabore10 += v;
    else if (t !== 'total') sem[t] += v;
  }
  sem.total =
    sem.diaria + sem.gratificacao + sem.premiacao + sem.transporte + sem.noturno + sem.proLaboreFixo + sem.outros;
  pagoCom10.total = pagoCom10.comissao + pagoCom10.proLabore10;

  // ---- VT
  let vtTotal = 0;
  for (const r of vt) {
    const total = diasEntre(r.ini, r.fim);
    if (total > 0) vtTotal += n(r.v) * (sobreposicao(r.ini, r.fim, ini, fim) / total);
  }

  const folhaTotal = contracheque.total + sem.total + vtTotal;
  const semMovimento = faturamento.total < FATURAMENTO_MINIMO;
  const semFolhaSemanal = semanal.length === 0;
  const pct =
    !semMovimento && !semFolhaSemanal && faturamento.total > 0
      ? (folhaTotal / faturamento.total) * 100
      : null;

  return {
    ...vazio,
    faturamento,
    folha: { contracheque, semanal: sem, vt: vtTotal, total: folhaTotal },
    pagoCom10,
    pct,
    faixa: faixaDoPct(pct),
    semMovimento,
    semFolhaSemanal,
  };
}

/** Soma várias casas do mesmo mês (o % do total sai das somas, não da média). */
export function somarCasas(linhas: FolhaFaturamentoMes[]): {
  faturamento: number;
  folha: number;
  pagoCom10: number;
  pct: number | null;
  faixa: Faixa | null;
} {
  const faturamento = linhas.reduce((a, l) => a + l.faturamento.total, 0);
  const folha = linhas.reduce((a, l) => a + l.folha.total, 0);
  const pagoCom10 = linhas.reduce((a, l) => a + l.pagoCom10.total, 0);
  // casa sem folha semanal lançada derruba o total (deixaria o % baixo demais)
  const incompleto = linhas.some((l) => l.semFolhaSemanal && !l.semMovimento);
  const pct = !incompleto && faturamento >= FATURAMENTO_MINIMO ? (folha / faturamento) * 100 : null;
  return { faturamento, folha, pagoCom10, pct, faixa: faixaDoPct(pct) };
}
