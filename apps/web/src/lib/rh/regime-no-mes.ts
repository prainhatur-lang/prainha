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
/** Troca de regime no meio do mês paga proporcional (ver calcularFolhaMensal). */
export interface TrocaNoMes {
  aPartir: string;
  regime: 'clt_mensal' | 'intermitente_hora';
  salario: number;
}

export async function comRegimeDoMes<
  F extends { id: string; regimeSalarial: string | null; salarioBase: string | null },
>(funcs: F[], iniMes: string): Promise<(F & { trocaNoMes?: TrocaNoMes })[]> {
  if (!funcs.length) return funcs;
  const agendas = await db
    .select({
      funcionarioId: schema.funcionarioRegimeAgenda.funcionarioId,
      aPartir: schema.funcionarioRegimeAgenda.aPartir,
      regimeAnterior: schema.funcionarioRegimeAgenda.regimeAnterior,
      salarioAnterior: schema.funcionarioRegimeAgenda.salarioAnterior,
      regimeNovo: schema.funcionarioRegimeAgenda.regimeSalarial,
      salarioNovo: schema.funcionarioRegimeAgenda.salarioBase,
      motivo: schema.funcionarioRegimeAgenda.motivo,
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
  // Mês da troca dividido (dono 09/11/2026, José e Manuel da Mar viraram 12x36
  // no meio de out: "retroativo a partir do ponto de 12h"): só quando o motivo
  // da agenda diz "proporcional". As outras trocas no meio do mês (ex.: Antonio
  // 31/10) seguem com o mês inteiro no regime anterior, como antes.
  const [a0, m0] = iniMes.split('-').map(Number);
  const fimMes = `${iniMes.slice(0, 7)}-${String(new Date(Date.UTC(a0!, m0!, 0)).getUTCDate()).padStart(2, '0')}`;
  return funcs.map((f) => {
    const a = primeira.get(f.id);
    if (!a || !a.regimeAnterior) return f;
    const troca: TrocaNoMes | undefined =
      a.aPartir <= fimMes &&
      /proporcional/i.test(a.motivo ?? '') &&
      (a.regimeNovo === 'clt_mensal' || a.regimeNovo === 'intermitente_hora') &&
      Number(a.salarioNovo) > 0
        ? { aPartir: a.aPartir, regime: a.regimeNovo, salario: Number(a.salarioNovo) }
        : undefined;
    return {
      ...f,
      regimeSalarial: a.regimeAnterior,
      salarioBase: a.salarioAnterior ?? f.salarioBase,
      ...(troca ? { trocaNoMes: troca } : {}),
    };
  });
}
