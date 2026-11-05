// Folha calculada pelo sistema (ponto + salário do cadastro), por casa e mês —
// a mesma conta de /rh/folha-contador/nossa/imprimir. Base do botão "Lançar
// pagamentos da folha" (dono 05/11/2026: "vamos lançar pela nossa folha do
// sistema", não pela do contador).

import { db, schema } from '@concilia/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { comRegimeDoMes } from '@/lib/rh/regime-no-mes';
import { calcularFolhaMensal, type RegimeFolha } from '@/lib/rh/folha-mensal';
import { ajudaCustoPorCpf, horasDoMesPorCpf, salarioFamiliaPorCpf } from '@/lib/rh/folha-mensal-dados';
import { proximosFeriados } from '@/lib/reservas/feriados';

export interface LinhaNossaFolha {
  funcionarioId: string;
  nome: string;
  cpf: string | null;
  empresaRegistro: string | null;
  cnpjRegistro: string | null;
  fornecedorId: string | null;
  liquido: number;
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
  const [horas, feriados, salFamilia, ajudaCusto] = await Promise.all([
    horasDoMesPorCpf(cpfs, ini, fim),
    proximosFeriados(ini, 31).then((l) => l.map((f) => f.data)),
    salarioFamiliaPorCpf(cpfs, comp),
    ajudaCustoPorCpf(cpfs, comp),
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
    });
    return {
      funcionarioId: f.id,
      nome: f.nome,
      cpf: f.cpf,
      empresaRegistro: f.empresaRegistro,
      cnpjRegistro: f.cnpjRegistro,
      fornecedorId: f.fornecedorId,
      liquido: calc.liquido,
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
