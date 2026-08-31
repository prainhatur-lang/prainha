// Custo de pessoal CLT — indicador de fechamento, NÃO gera conta_pagar (o
// pagamento real passa por fora, via a empresa terceirizada de folha).
// Ver decisão em CLAUDE.md/plano Fase 2: "Custo CLT = indicador".

import { db, schema } from '@concilia/db';
import { and, eq, gte, lte, sql } from 'drizzle-orm';

/** FGTS é fixo por lei — não varia por regime tributário como o resto dos
 *  encargos (esse fica configurável em folha_config.pct_encargos_clt). */
const FGTS_PCT = 0.08;

const num = (v: string | number | null): number => (v == null ? 0 : Number(v));

function mesBounds(ano: number, mes: number) {
  const mm = String(mes).padStart(2, '0');
  const lastDay = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { ymdStart: `${ano}-${mm}-01`, ymdEnd: `${ano}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

export interface LinhaCustoClt {
  funcionarioId: string;
  nome: string;
  cargo: string | null;
  regimeSalarial: 'clt_mensal' | 'intermitente_hora';
  salarioBase: number;
  /** Só preenchido em intermitente_hora — horas reais do mês (folha_horas). */
  horasMes: number | null;
  /** Base de cálculo do mês: = salarioBase (clt_mensal) ou salarioBase × horasMes (intermitente_hora). */
  baseCalculo: number;
  encargos: number;
  decimoTerceiro: number;
  feriasUmTerco: number;
  total: number;
  /** true = intermitente_hora sem nenhuma hora registrada em folha_horas no mês (sem fornecedor vinculado ou sem horas lançadas). */
  semHorasRegistradas: boolean;
}

export interface CustoClt {
  pctEncargosClt: number;
  linhas: LinhaCustoClt[];
  totalBaseCalculo: number;
  totalEncargos: number;
  total13Ferias: number;
  totalGeral: number;
}

/** Custo estimado de pessoal CLT/intermitente de uma filial num mês.
 *  clt_mensal: base = salarioBase (R$/mês).
 *  intermitente_hora: base = salarioBase (R$/hora) × horas reais do mês,
 *  lidas de folha_horas (mesma fonte que paga a folha semanal). */
export async function calcularCustoClt(filialId: string, ano: number, mes: number): Promise<CustoClt> {
  const { ymdStart, ymdEnd } = mesBounds(ano, mes);

  const [config] = await db
    .select({ pctEncargosClt: schema.folhaConfig.pctEncargosClt })
    .from(schema.folhaConfig)
    .where(eq(schema.folhaConfig.filialId, filialId));
  const pctEncargosClt = num(config?.pctEncargosClt ?? '20.00');

  const funcionarios = await db
    .select({
      id: schema.funcionario.id,
      nome: schema.funcionario.nome,
      cargo: schema.funcionario.cargo,
      regimeSalarial: schema.funcionario.regimeSalarial,
      salarioBase: schema.funcionario.salarioBase,
      fornecedorId: schema.funcionario.fornecedorId,
    })
    .from(schema.funcionario)
    .where(
      and(
        eq(schema.funcionario.filialId, filialId),
        sql`${schema.funcionario.regimeSalarial} IS NOT NULL`,
        sql`${schema.funcionario.salarioBase} IS NOT NULL`,
        sql`(${schema.funcionario.dataAdmissao} IS NULL OR ${schema.funcionario.dataAdmissao} <= ${ymdEnd})`,
        sql`(${schema.funcionario.dataDesligamento} IS NULL OR ${schema.funcionario.dataDesligamento} >= ${ymdStart})`,
      ),
    );

  const horasPorFornecedor = await db
    .select({
      fornecedorId: schema.folhaHoras.fornecedorId,
      totalMin: sql<number>`coalesce(sum(${schema.folhaHoras.totalMin}),0)::int`,
    })
    .from(schema.folhaHoras)
    .innerJoin(schema.folhaSemana, eq(schema.folhaHoras.folhaSemanaId, schema.folhaSemana.id))
    .where(
      and(
        eq(schema.folhaSemana.filialId, filialId),
        gte(schema.folhaHoras.dia, ymdStart),
        lte(schema.folhaHoras.dia, ymdEnd),
      ),
    )
    .groupBy(schema.folhaHoras.fornecedorId);
  const minutosPorFornecedor = new Map(horasPorFornecedor.map((h) => [h.fornecedorId, h.totalMin]));

  const linhas: LinhaCustoClt[] = funcionarios.map((f) => {
    const regime = f.regimeSalarial as 'clt_mensal' | 'intermitente_hora';
    const salarioBase = num(f.salarioBase);

    let horasMes: number | null = null;
    let baseCalculo: number;
    let semHorasRegistradas = false;
    if (regime === 'intermitente_hora') {
      const totalMin = f.fornecedorId ? (minutosPorFornecedor.get(f.fornecedorId) ?? 0) : 0;
      horasMes = totalMin / 60;
      baseCalculo = salarioBase * horasMes;
      semHorasRegistradas = totalMin === 0;
    } else {
      baseCalculo = salarioBase;
    }

    const encargos = baseCalculo * (pctEncargosClt / 100 + FGTS_PCT);
    const decimoTerceiro = baseCalculo / 12;
    const feriasUmTerco = (baseCalculo / 12) * (4 / 3);
    const total = baseCalculo + encargos + decimoTerceiro + feriasUmTerco;

    return {
      funcionarioId: f.id,
      nome: f.nome,
      cargo: f.cargo,
      regimeSalarial: regime,
      salarioBase,
      horasMes,
      baseCalculo,
      encargos,
      decimoTerceiro,
      feriasUmTerco,
      total,
      semHorasRegistradas,
    };
  });

  return {
    pctEncargosClt,
    linhas,
    totalBaseCalculo: linhas.reduce((a, l) => a + l.baseCalculo, 0),
    totalEncargos: linhas.reduce((a, l) => a + l.encargos, 0),
    total13Ferias: linhas.reduce((a, l) => a + l.decimoTerceiro + l.feriasUmTerco, 0),
    totalGeral: linhas.reduce((a, l) => a + l.total, 0),
  };
}
