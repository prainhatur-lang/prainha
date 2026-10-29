// Junta, por CPF, as horas do mês pra folha calculada pelo sistema
// (lib/rh/folha-mensal.ts): o Stelanto (stelanto_dia) era o relógio oficial
// até a troca (Mar 28/09, Bar e Tabuará 01/10/2026) e vale no dia em que tem
// hora; nos outros dias, o ponto próprio (ponto_batida). No fim de setembro
// os dois rodaram juntos e o ponto novo ainda tinha batida faltando.
// Soma todas as linhas de funcionário com o mesmo CPF (quem trabalha em mais
// de uma casa).

import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { calcularDia, minutosNoturnos, type Batida } from './calcular-ponto';
import type { DiaHoras } from './folha-mensal';

export async function horasDoMesPorCpf(cpfs: string[], ini: string, fim: string): Promise<Map<string, DiaHoras[]>> {
  const saida = new Map<string, DiaHoras[]>();
  if (cpfs.length === 0) return saida;

  const funcs = await db
    .select({ id: schema.funcionario.id, cpf: schema.funcionario.cpf })
    .from(schema.funcionario)
    .where(inArray(schema.funcionario.cpf, cpfs));
  const cpfDoFunc = new Map(funcs.map((f) => [f.id, f.cpf as string]));

  // Ponto: pareia por funcionário + casa + dia, depois soma no CPF + dia.
  const ponto = new Map<string, { min: number; noturnoMin: number }>();
  if (funcs.length) {
    const batidas = await db
      .select({
        funcionarioId: schema.pontoBatida.funcionarioId,
        filialId: schema.pontoBatida.filialId,
        dia: schema.pontoBatida.diaOperacional,
        quando: schema.pontoBatida.quando,
        tipo: schema.pontoBatida.tipo,
      })
      .from(schema.pontoBatida)
      .where(
        and(
          inArray(schema.pontoBatida.funcionarioId, funcs.map((f) => f.id)),
          gte(schema.pontoBatida.diaOperacional, ini),
          lte(schema.pontoBatida.diaOperacional, fim),
          isNull(schema.pontoBatida.excluidaEm),
        ),
      );
    const grupos = new Map<string, Batida[]>();
    for (const b of batidas) {
      const k = `${b.funcionarioId}|${b.filialId}|${b.dia}`;
      const lista = grupos.get(k) ?? [];
      lista.push({ quando: b.quando, tipo: b.tipo === 'saida' ? 'saida' : 'entrada' });
      grupos.set(k, lista);
    }
    for (const [k, lista] of grupos) {
      const [funcId, , dia] = k.split('|');
      const calc = calcularDia(lista);
      if (calc.totalMin <= 0) continue;
      const kk = `${cpfDoFunc.get(funcId)}|${dia}`;
      const atual = ponto.get(kk) ?? { min: 0, noturnoMin: 0 };
      atual.min += calc.totalMin;
      atual.noturnoMin += minutosNoturnos(calc.pares).reais;
      ponto.set(kk, atual);
    }
  }

  // Stelanto: horas antes do ponto próprio.
  const stelanto = new Map<string, { min: number; noturnoMin: number }>();
  const dias = await db
    .select({
      cpf: schema.stelantoColaborador.cpf,
      dia: schema.stelantoDia.dia,
      trabalhadoSeg: schema.stelantoDia.trabalhadoSeg,
      noturnoSeg: schema.stelantoDia.noturnoSeg,
    })
    .from(schema.stelantoDia)
    .innerJoin(schema.stelantoColaborador, eq(schema.stelantoColaborador.id, schema.stelantoDia.colaboradorId))
    .where(
      and(
        inArray(schema.stelantoColaborador.cpf, cpfs),
        gte(schema.stelantoDia.dia, ini),
        lte(schema.stelantoDia.dia, fim),
      ),
    );
  for (const d of dias) {
    if (!d.cpf || d.trabalhadoSeg <= 0) continue;
    const kk = `${d.cpf}|${d.dia}`;
    const atual = stelanto.get(kk) ?? { min: 0, noturnoMin: 0 };
    atual.min += d.trabalhadoSeg / 60;
    atual.noturnoMin += d.noturnoSeg / 60;
    stelanto.set(kk, atual);
  }

  const chaves = new Set([...ponto.keys(), ...stelanto.keys()]);
  for (const kk of chaves) {
    const [cpf, dia] = kk.split('|');
    const p = ponto.get(kk);
    const s = stelanto.get(kk);
    const d: DiaHoras = s
      ? { dia, min: s.min, noturnoMin: s.noturnoMin, fonte: 'stelanto' }
      : { dia, min: p!.min, noturnoMin: p!.noturnoMin, fonte: 'ponto' };
    const lista = saida.get(cpf) ?? [];
    lista.push(d);
    saida.set(cpf, lista);
  }
  for (const lista of saida.values()) lista.sort((a, b) => a.dia.localeCompare(b.dia));
  return saida;
}
