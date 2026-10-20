// Horas por regime (pedido do dono 20/10/2026): "o que era intermitente, pra
// trabalhar só quando precisa, tá trabalhando muito mais; e quem é CLT não tá
// batendo a escala". Semana a semana, na casa:
//  - CLT da casa (cadastro): horas batidas em QUALQUER casa × jornada prevista
//    (escala fixa do cadastro; sem escala = 44 h) → falta e excesso;
//  - intermitente: horas batidas NESTA casa e custo estimado;
//  - quem bateu aqui e não está em folha nenhuma do contador ("sem registro");
//  - venda da semana e venda por hora-pessoa.
// Regime vem da folha do contador (vínculo do último mês importado); sem folha,
// do cadastro. Horas: ponto próprio da virada em diante, Stelanto antes (o dia
// do Stelanto conta na casa do colaborador de lá). Só leitura.

import { db } from '@concilia/db';
import { sql, type SQL } from 'drizzle-orm';
import { calcularDia } from '@/lib/rh/calcular-ponto';
import { pontoProprioDesde } from '@/lib/rh/ponto-vigencia';
import { somarDias, PONTO_VIRADA_HORA } from '@/lib/rh/dia-operacional';
import { dateToBrYmd } from '@/lib/datas';
import { jornadaNoDia, minutosPrevistos, type VigenciaJornada } from '@/lib/rh/banco-horas';

async function q<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Intermitente da E.B.: hora + DSR 1/6 + férias 1/12 + 1/3 + 13º 1/12 (o
 *  contracheque de 09/2026 dá 1,39×) e FGTS 8% por cima. */
export const FATOR_INTERMITENTE = 1.3935 * 1.08;
/** CLT mensal: salário + provisão de férias/1/3/13º (~19,4%) + FGTS 8%. */
export const FATOR_CLT = 1.194 * 1.08;
/** 44 h por semana quando a pessoa não tem escala fixa no cadastro. */
export const PREVISTO_PADRAO_MIN = 44 * 60;

export type Regime = 'clt' | 'intermitente' | 'sem_registro';

export interface Semana {
  inicio: string; // segunda
  fim: string; // domingo
  parcial: boolean;
}

export interface PessoaHoras {
  id: string;
  nome: string;
  cargo: string | null;
  regime: Regime;
  /** true = regime veio do cadastro (pessoa não está na folha do contador). */
  semFolha: boolean;
  regimeCadastro: string | null;
  /** valor da hora (intermitente) ou salário do mês (CLT). */
  valor: number | null;
  daCasa: boolean;
  /** Trava do ponto facial: máx. de dias por semana (null = sem limite). */
  limiteDiasSemana: number | null;
  /** Dia que o gerente liberou por fora da trava (YYYY-MM-DD). */
  limiteLiberadoDia: string | null;
  /** por semana: min batidos NESTA casa, min em todas, dias, previsto (CLT). */
  semanas: { minCasa: number; minTotal: number; dias: number; previstoMin: number }[];
}

export interface ResumoSemana {
  venda: number;
  minTotalCasa: number;
  cltPrevistoMin: number;
  cltTrabMin: number;
  cltFaltaMin: number;
  cltExcessoMin: number;
  intMin: number;
  intCusto: number;
  intComoFixo: number;
  semRegMin: number;
}

export interface HorasRegime {
  semanas: Semana[];
  pessoas: PessoaHoras[];
  resumo: ResumoSemana[];
  competenciaFolha: string | null;
}

/** Segunda-feira da semana do dia (calendário, sem fuso). */
function segundaDe(ymd: string): string {
  const dow = new Date(ymd + 'T12:00:00Z').getUTCDay(); // 0 = domingo
  return somarDias(ymd, dow === 0 ? -6 : 1 - dow);
}

export async function montarHorasRegime(filialId: string, hoje: string, numSemanas: number): Promise<HorasRegime> {
  const ontem = somarDias(hoje, -1);
  const ultimaSeg = segundaDe(ontem);
  const semanas: Semana[] = [];
  for (let i = numSemanas - 1; i >= 0; i--) {
    const inicio = somarDias(ultimaSeg, -7 * i);
    const fim = somarDias(inicio, 6);
    semanas.push({ inicio, fim, parcial: fim > ontem });
  }
  const ini = semanas[0].inicio;
  const fimPeriodo = ontem;
  const idxSemana = (dia: string) => {
    for (let i = 0; i < semanas.length; i++) if (dia >= semanas[i].inicio && dia <= semanas[i].fim) return i;
    return -1;
  };

  const [batidas, stelanto, folhas, cadastro, vendas] = await Promise.all([
    q<{ funcionario_id: string; filial_id: string; dia: string; quando: Date; tipo: string }>(sql`
      SELECT funcionario_id, filial_id, dia_operacional::text AS dia, quando, tipo
        FROM ponto_batida
       WHERE excluida_em IS NULL AND dia_operacional BETWEEN ${ini}::date AND ${fimPeriodo}::date`),
    q<{ funcionario_id: string; filial_id: string | null; dia: string; seg: number }>(sql`
      SELECT c.funcionario_id, c.filial_id, d.dia::text AS dia, d.trabalhado_seg AS seg
        FROM stelanto_dia d JOIN stelanto_colaborador c ON c.id = d.colaborador_id
       WHERE c.funcionario_id IS NOT NULL AND d.trabalhado_seg > 0
         AND d.dia BETWEEN ${ini}::date AND ${fimPeriodo}::date`),
    // Último mês importado de cada pessoa.
    q<{ funcionario_id: string; competencia: string; vinculo: string | null; salario: string | null }>(sql`
      SELECT DISTINCT ON (funcionario_id) funcionario_id, competencia, vinculo, salario
        FROM folha_contador
       WHERE funcionario_id IS NOT NULL AND (demitido_em IS NULL)
       ORDER BY funcionario_id, competencia DESC`),
    q<{ id: string; nome: string; cargo: string | null; filial_id: string; regime: string | null; salario_base: string | null; ativo: boolean; data_admissao: string | null; limite_dias_semana: number | null; limite_liberado_dia: string | null }>(sql`
      SELECT id, nome, cargo, filial_id, regime_salarial AS regime, salario_base, ativo, data_admissao::text AS data_admissao,
             limite_dias_semana, limite_liberado_dia::text AS limite_liberado_dia
        FROM funcionario`),
    // Dia operacional da venda: conta aberta de madrugada é do dia anterior (virada 05:00).
    q<{ dia: string; total: number }>(sql`
      SELECT ((data_abertura AT TIME ZONE 'America/Sao_Paulo') - interval '5 hours')::date::text AS dia,
             coalesce(sum(valor_total), 0)::float8 AS total
        FROM pedido
       WHERE filial_id = ${filialId} AND data_delete IS NULL
         AND data_abertura >= ${ini + 'T05:00:00-03:00'}::timestamptz
         AND data_abertura < ${somarDias(fimPeriodo, 1) + 'T05:00:00-03:00'}::timestamptz
       GROUP BY 1`),
  ]);

  // funcionario|dia|filial -> minutos (ponto próprio só da virada de cada casa em diante)
  const grupos = new Map<string, { quando: Date; tipo: 'entrada' | 'saida' }[]>();
  for (const b of batidas) {
    if (b.dia < pontoProprioDesde(b.filial_id)) continue;
    const k = `${b.funcionario_id}|${b.dia}|${b.filial_id}`;
    const l = grupos.get(k) ?? [];
    l.push({ quando: new Date(b.quando), tipo: b.tipo as 'entrada' | 'saida' });
    grupos.set(k, l);
  }
  const minDia = new Map<string, number>(); // funcionario|dia|filial
  for (const [k, l] of grupos) {
    const m = calcularDia(l).totalMin;
    if (m > 0) minDia.set(k, m);
  }
  // Dia que já tem ponto próprio (em qualquer casa) não soma o Stelanto: na
  // virada da Mar (28/09) quem trabalhou lá aparecia nos dois.
  const temPonto = new Set<string>();
  for (const k of minDia.keys()) {
    const [fid, dia] = k.split('|');
    temPonto.add(`${fid}|${dia}`);
  }
  for (const s of stelanto) {
    const casa = s.filial_id ?? '';
    if (casa && s.dia >= pontoProprioDesde(casa)) continue;
    if (temPonto.has(`${s.funcionario_id}|${s.dia}`)) continue;
    const k = `${s.funcionario_id}|${s.dia}|${casa}`;
    minDia.set(k, (minDia.get(k) ?? 0) + Math.round(num(s.seg) / 60));
  }

  const folhaPor = new Map(folhas.map((f) => [f.funcionario_id, f]));
  const competenciaFolha = folhas.reduce<string | null>((m, f) => (!m || f.competencia > m ? f.competencia : m), null);

  // Quem entra: CLT/intermitente ativo da casa + quem bateu aqui no período.
  const bateuAqui = new Set<string>();
  for (const k of minDia.keys()) {
    const [fid, , casa] = k.split('|');
    if (casa === filialId) bateuAqui.add(fid);
  }

  // Escala fixa (previsto) dos CLT.
  const vigRows = await q<VigenciaJornada & { funcionario_id: string }>(sql`
    SELECT fj.funcionario_id, fj.vigente_desde::text AS "vigenteDesde", j.id AS "jornadaId", j.nome, j.tipo,
           j.min_seg AS "minSeg", j.min_ter AS "minTer", j.min_qua AS "minQua", j.min_qui AS "minQui",
           j.min_sex AS "minSex", j.min_sab AS "minSab", j.min_dom AS "minDom"
      FROM funcionario_jornada fj JOIN rh_jornada j ON j.id = fj.jornada_id`);
  const vigPor = new Map<string, VigenciaJornada[]>();
  for (const v of vigRows) {
    const l = vigPor.get(v.funcionario_id) ?? [];
    l.push({ ...v, minSeg: num(v.minSeg), minTer: num(v.minTer), minQua: num(v.minQua), minQui: num(v.minQui), minSex: num(v.minSex), minSab: num(v.minSab), minDom: num(v.minDom) });
    vigPor.set(v.funcionario_id, l);
  }

  const pessoas: PessoaHoras[] = [];
  for (const f of cadastro) {
    const daCasa = f.filial_id === filialId && f.ativo;
    if (!daCasa && !bateuAqui.has(f.id)) continue;
    const folha = folhaPor.get(f.id);
    let regime: Regime;
    let semFolha = false;
    let valor: number | null = null;
    if (folha) {
      regime = /intermit/i.test(folha.vinculo ?? '') ? 'intermitente' : 'clt';
      valor = folha.salario != null ? num(folha.salario) : null;
    } else {
      semFolha = true;
      regime = 'sem_registro';
      valor = f.salario_base != null ? num(f.salario_base) : null;
    }

    const sem = semanas.map(() => ({ minCasa: 0, minTotal: 0, dias: 0, previstoMin: 0 }));
    const diasVistos = new Set<string>();
    for (const [k, m] of minDia) {
      const [fid, dia, casa] = k.split('|');
      if (fid !== f.id) continue;
      const i = idxSemana(dia);
      if (i < 0) continue;
      sem[i].minTotal += m;
      if (casa === filialId) sem[i].minCasa += m;
      if (!diasVistos.has(dia)) {
        diasVistos.add(dia);
        sem[i].dias++;
      }
    }
    if (regime === 'clt' && daCasa) {
      const vig = vigPor.get(f.id) ?? [];
      semanas.forEach((s, i) => {
        let prev = 0;
        let semEscala = 0;
        for (let d = s.inicio; d <= s.fim && d <= fimPeriodo; d = somarDias(d, 1)) {
          if (f.data_admissao && d < f.data_admissao) continue;
          const j = jornadaNoDia(vig, d);
          if (j && j.tipo === 'fixa') prev += minutosPrevistos(j, d);
          else semEscala++;
        }
        prev += Math.round((PREVISTO_PADRAO_MIN * semEscala) / 7);
        sem[i].previstoMin = prev;
      });
    }
    if (!daCasa && sem.every((x) => x.minCasa === 0)) continue;
    pessoas.push({
      id: f.id,
      nome: f.nome,
      cargo: f.cargo,
      regime,
      semFolha,
      regimeCadastro: f.regime,
      valor,
      daCasa,
      limiteDiasSemana: f.limite_dias_semana != null ? num(f.limite_dias_semana) : null,
      limiteLiberadoDia: f.limite_liberado_dia,
      semanas: sem,
    });
  }

  const vendaSemana = semanas.map(() => 0);
  for (const v of vendas) {
    const i = idxSemana(v.dia);
    if (i >= 0) vendaSemana[i] += num(v.total);
  }

  const resumo: ResumoSemana[] = semanas.map((s, i) => {
    const r: ResumoSemana = {
      venda: vendaSemana[i],
      minTotalCasa: 0,
      cltPrevistoMin: 0,
      cltTrabMin: 0,
      cltFaltaMin: 0,
      cltExcessoMin: 0,
      intMin: 0,
      intCusto: 0,
      intComoFixo: 0,
      semRegMin: 0,
    };
    for (const p of pessoas) {
      const x = p.semanas[i];
      r.minTotalCasa += x.minCasa;
      if (p.regime === 'clt' && p.daCasa) {
        r.cltPrevistoMin += x.previstoMin;
        r.cltTrabMin += x.minTotal;
        r.cltFaltaMin += Math.max(0, x.previstoMin - x.minTotal);
        r.cltExcessoMin += Math.max(0, x.minTotal - x.previstoMin);
      } else if (p.regime === 'intermitente') {
        r.intMin += x.minCasa;
        if (p.valor) r.intCusto += (x.minCasa / 60) * p.valor * FATOR_INTERMITENTE;
        if (!s.parcial && x.dias >= 5 && x.minTotal >= 40 * 60) r.intComoFixo++;
      } else if (p.regime === 'sem_registro') {
        r.semRegMin += x.minCasa;
      }
    }
    return r;
  });

  pessoas.sort((a, b) => {
    const ord = { clt: 0, intermitente: 1, sem_registro: 2 } as const;
    if (ord[a.regime] !== ord[b.regime]) return ord[a.regime] - ord[b.regime];
    const ma = a.semanas.reduce((s, x) => s + x.minTotal, 0);
    const mb = b.semanas.reduce((s, x) => s + x.minTotal, 0);
    return mb - ma;
  });

  return { semanas, pessoas, resumo, competenciaFolha };
}

/** Dia do ponto de agora (vira às 05:00) e a segunda-feira da semana dele. */
export function semanaDoPontoAgora(): { hoje: string; segunda: string } {
  const hoje = dateToBrYmd(new Date(Date.now() - PONTO_VIRADA_HORA * 3600 * 1000));
  return { hoje, segunda: segundaDe(hoje) };
}

/** Dias distintos com batida (qualquer casa) na semana do ponto de agora, por
 *  pessoa — o mesmo número que a trava do tablet usa. */
export async function diasNaSemanaAtual(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const { hoje, segunda } = semanaDoPontoAgora();
  const rows = await q<{ funcionario_id: string; n: number }>(sql`
    SELECT funcionario_id, COUNT(DISTINCT dia_operacional)::int AS n
      FROM ponto_batida
     WHERE funcionario_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
       AND dia_operacional BETWEEN ${segunda}::date AND ${hoje}::date
       AND excluida_em IS NULL
     GROUP BY funcionario_id`);
  for (const r of rows) out.set(r.funcionario_id, num(r.n));
  return out;
}
