import { db, schema } from '@concilia/db';
import { and, gt, inArray, isNull } from 'drizzle-orm';

/**
 * O cadastro (regime_salarial/salario_base) guarda só o valor de HOJE. Quando
 * uma troca agendada em funcionario_regime_agenda começa depois do dia 1 do
 * mês da folha, aquele mês ainda era do regime anterior (ex.: Tabuará virou
 * CLT em 01/11/2026 — a folha de outubro tem que sair como intermitente).
 * Devolve os funcionários com regime/salário do começo do mês; quem não tem
 * agenda passa igual.
 */
export async function comRegimeDoMes<
  F extends { id: string; regimeSalarial: string | null; salarioBase: string | null },
>(funcs: F[], iniMes: string): Promise<F[]> {
  if (!funcs.length) return funcs;
  const agendas = await db
    .select({
      funcionarioId: schema.funcionarioRegimeAgenda.funcionarioId,
      aPartir: schema.funcionarioRegimeAgenda.aPartir,
      regimeAnterior: schema.funcionarioRegimeAgenda.regimeAnterior,
      salarioAnterior: schema.funcionarioRegimeAgenda.salarioAnterior,
    })
    .from(schema.funcionarioRegimeAgenda)
    .where(
      and(
        inArray(
          schema.funcionarioRegimeAgenda.funcionarioId,
          funcs.map((f) => f.id),
        ),
        gt(schema.funcionarioRegimeAgenda.aPartir, iniMes),
        isNull(schema.funcionarioRegimeAgenda.canceladoEm),
      ),
    );
  // A primeira troca depois do dia 1 diz como estava no começo do mês.
  const primeira = new Map<string, (typeof agendas)[number]>();
  for (const a of agendas) {
    const at = primeira.get(a.funcionarioId);
    if (!at || a.aPartir < at.aPartir) primeira.set(a.funcionarioId, a);
  }
  return funcs.map((f) => {
    const a = primeira.get(f.id);
    if (!a || !a.regimeAnterior) return f;
    return { ...f, regimeSalarial: a.regimeAnterior, salarioBase: a.salarioAnterior ?? f.salarioBase };
  });
}
