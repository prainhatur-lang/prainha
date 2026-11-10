// Folha calculada pelo sistema (ponto + salário do cadastro), por casa e mês —
// a mesma conta de /rh/folha-contador/nossa/imprimir. Base do botão "Lançar
// pagamentos da folha" (dono 05/11/2026: "vamos lançar pela nossa folha do
// sistema", não pela do contador).

import { db, schema } from '@concilia/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { comRegimeDoMes } from '@/lib/rh/regime-no-mes';
import { calcularFolhaMensal, type RegimeFolha } from '@/lib/rh/folha-mensal';
import { afastamentosPorCpf, ajudaCustoPorCpf, horasDoMesPorCpf, diferencaSalarialPorCpf, planoSaudePorCpf, quebraCaixaPorCpf, salarioFamiliaPorCpf } from '@/lib/rh/folha-mensal-dados';
import { proximosFeriados } from '@/lib/reservas/feriados';

export interface LinhaNossaFolha {
  funcionarioId: string;
  nome: string;
  cpf: string | null;
  empresaRegistro: string | null;
  cnpjRegistro: string | null;
  fornecedorId: string | null;
  desligamento: string | null;
  liquido: number;
  /** Do mesmo cálculo — base da fatura da E.B. (dono 05/11/2026: "vou pagar pela nossa folha"). */
  proventos: number;
  fgts: number;
  horas: number;
  /** Regime no mês (agenda aplicada): clt_mensal | intermitente_hora. */
  regime: string;
  /** Valor da hora (intermitente) ou salário do mês (CLT) no cadastro. */
  salario: number;
}

const ultimoDiaComp = (comp: string) => {
  const [a, m] = comp.split('-').map(Number);
  return `${comp}-${String(new Date(Date.UTC(a!, m!, 0)).getUTCDate()).padStart(2, '0')}`;
};

export async function nossaFolhaDoMes(filialId: string, comp: string): Promise<LinhaNossaFolha[]> {
  const ini = `${comp}-01`;
  const fim = ultimoDiaComp(comp);
  const todos = await comRegimeDoMes(
    await db
      .select()
      .from(schema.funcionario)
      .where(and(eq(schema.funcionario.filialId, filialId), isNotNull(schema.funcionario.regimeSalarial))),
    ini,
  );
  const doMes = todos.filter(
    (f) =>
      (!f.dataAdmissao || f.dataAdmissao <= fim) &&
      (!f.dataDesligamento || f.dataDesligamento >= ini) &&
      (f.regimeSalarial === 'clt_mensal' || f.regimeSalarial === 'intermitente_hora') &&
      Number(f.salarioBase) > 0,
  );
  const cpfs = [...new Set(doMes.map((f) => f.cpf).filter((c): c is string => !!c))];
  const [horas, feriados, salFamilia, ajudaCusto, afast, quebraCaixa, planoSaude, difSalarial] = await Promise.all([
    horasDoMesPorCpf(cpfs, ini, fim),
    proximosFeriados(ini, 31).then((l) => l.map((f) => f.data)),
    salarioFamiliaPorCpf(cpfs, comp),
    ajudaCustoPorCpf(cpfs, comp),
    afastamentosPorCpf(cpfs, ini, fim),
    quebraCaixaPorCpf(cpfs, comp),
    planoSaudePorCpf(cpfs, comp),
    diferencaSalarialPorCpf(cpfs, comp),
  ]);
  return doMes.map((f) => {
    const calc = calcularFolhaMensal({
      regime: f.regimeSalarial as RegimeFolha,
      salario: Number(f.salarioBase),
      comp,
      admissao: f.dataAdmissao,
      desligamento: f.dataDesligamento,
      dias: f.cpf ? horas.get(f.cpf) ?? [] : [],
      feriados,
      salarioFamilia: f.cpf ? salFamilia.get(f.cpf) : null,
      ajudaCusto: f.cpf ? ajudaCusto.get(f.cpf) : null,
      quebraCaixa: f.cpf ? quebraCaixa.get(f.cpf) : null,
      planoSaude: f.cpf ? planoSaude.get(f.cpf) : null,
      diferencaSalarial: f.cpf ? difSalarial.get(f.cpf) : null,
      afastamentos: f.cpf ? afast.get(f.cpf) : null,
      troca: f.trocaNoMes ?? null,
    });
    return {
      funcionarioId: f.id,
      nome: f.nome,
      cpf: f.cpf,
      empresaRegistro: f.empresaRegistro,
      cnpjRegistro: f.cnpjRegistro,
      fornecedorId: f.fornecedorId,
      desligamento: f.dataDesligamento,
      liquido: calc.liquido,
      proventos: calc.proventos,
      fgts: calc.fgts,
      horas: calc.horas,
      regime: f.regimeSalarial as string,
      salario: Number(f.salarioBase),
    };
  });
}

// Quem tem regime no cadastro e estava na casa no mês, mas sem salário/valor da
// hora: a nossa folha não calcula (fica de fora do lançamento). Ex.: Rivaldo
// (Bar) em out/2026 — contador pagou 1.698,28 e o sistema não.
export async function semSalarioNoMes(filialId: string, comp: string): Promise<string[]> {
  const ini = `${comp}-01`;
  const fim = ultimoDiaComp(comp);
  const todos = await comRegimeDoMes(
    await db
      .select()
      .from(schema.funcionario)
      .where(and(eq(schema.funcionario.filialId, filialId), isNotNull(schema.funcionario.regimeSalarial))),
    ini,
  );
  return todos
    .filter(
      (f) =>
        (!f.dataAdmissao || f.dataAdmissao <= fim) &&
        (!f.dataDesligamento || f.dataDesligamento >= ini) &&
        (f.regimeSalarial === 'clt_mensal' || f.regimeSalarial === 'intermitente_hora') &&
        !(Number(f.salarioBase) > 0),
    )
    .map((f) => f.nome);
}

// Quem saiu dentro do mês: recebe pela rescisão (TRCT), não pela folha do mês —
// o contador zera o líquido mensal com a linha "LIQUIDO RESCISAO". Lançar a folha
// dessas pessoas pagaria em dobro (out/2026 na Mar: 10 pessoas, ~R$ 15 mil).
export async function saidasNoMes(filialId: string, comp: string): Promise<{ nome: string; desligamento: string }[]> {
  const ini = `${comp}-01`;
  const fim = ultimoDiaComp(comp);
  const linhas = await db
    .select({ nome: schema.funcionario.nome, desligamento: schema.funcionario.dataDesligamento })
    .from(schema.funcionario)
    .where(and(eq(schema.funcionario.filialId, filialId), isNotNull(schema.funcionario.regimeSalarial)));
  return linhas
    .filter((l): l is { nome: string; desligamento: string } => !!l.desligamento && l.desligamento >= ini && l.desligamento <= fim)
    .sort((a, b) => a.nome.localeCompare(b.nome));
}
