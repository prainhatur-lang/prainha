// Junta, por CPF, as horas do mês pra folha calculada pelo sistema
// (lib/rh/folha-mensal.ts): o Stelanto (stelanto_dia) era o relógio oficial
// até a troca (Mar 28/09, Bar e Tabuará 01/10/2026) e vale no dia em que tem
// hora; nos outros dias, o ponto próprio (ponto_batida). No fim de setembro
// os dois rodaram juntos e o ponto novo ainda tinha batida faltando.
// Soma todas as linhas de funcionário com o mesmo CPF (quem trabalha em mais
// de uma casa).

import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, inArray, isNull, lt, lte } from 'drizzle-orm';
import { calcularDia, faltaIntervalo, minutosDoDia, minutosNoturnos, type Batida } from './calcular-ponto';
import type { DiaHoras } from './folha-mensal';

/** Salário mínimo 2026 (base da quebra de caixa do intermitente). */
const SALARIO_MINIMO_2026 = 1621;

export async function horasDoMesPorCpf(cpfs: string[], ini: string, fim: string): Promise<Map<string, DiaHoras[]>> {
  const saida = new Map<string, DiaHoras[]>();
  if (cpfs.length === 0) return saida;

  const funcs = await db
    .select({ id: schema.funcionario.id, cpf: schema.funcionario.cpf, intervaloPre: schema.funcionario.intervaloPreAssinalado })
    .from(schema.funcionario)
    .where(inArray(schema.funcionario.cpf, cpfs));
  const cpfDoFunc = new Map(funcs.map((f) => [f.id, f.cpf as string]));
  // Intervalo pré-assinalado (07/11/2026): desconta 30 min em vez de pendente.
  const preIntervalo = new Set(funcs.filter((f) => f.intervaloPre).map((f) => f.id));

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
      // Intervalo obrigatório (03/11/2026): dia > 6h sem intervalo batido fica
      // pendente — não paga até o gestor lançar o intervalo em /rh/ponto.
      const pre = preIntervalo.has(funcId);
      if (faltaIntervalo(dia, calc, pre)) continue;
      const kk = `${cpfDoFunc.get(funcId)}|${dia}`;
      const atual = ponto.get(kk) ?? { min: 0, noturnoMin: 0 };
      atual.min += minutosDoDia(dia, calc, pre);
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

/**
 * Salário-família por CPF: cotas e valor da cota da folha do contador mais
 * recente antes da competência (rubrica 995). O sistema não sabe quantos
 * filhos cada um tem; o contador sabe.
 */
export async function salarioFamiliaPorCpf(cpfs: string[], comp: string): Promise<Map<string, { cotas: number; valorCota: number }>> {
  const saida = new Map<string, { cotas: number; valorCota: number }>();
  if (cpfs.length === 0) return saida;
  const linhas = await db
    .select({ cpf: schema.folhaContador.cpf, competencia: schema.folhaContador.competencia, rubricas: schema.folhaContador.rubricas })
    .from(schema.folhaContador)
    .where(and(lt(schema.folhaContador.competencia, comp), inArray(schema.folhaContador.cpf, cpfs)))
    .orderBy(desc(schema.folhaContador.competencia));
  const vistos = new Set<string>();
  const alvo = new Set(cpfs);
  for (const l of linhas) {
    const cpf = String(l.cpf ?? '').replace(/\D/g, '');
    if (!alvo.has(cpf) || vistos.has(cpf)) continue;
    vistos.add(cpf);
    const r = ((l.rubricas as { codigo: string; referencia: number; valor: number }[] | null) ?? []).find((x) => x.codigo === '995');
    if (r && r.referencia > 0 && r.valor > 0) saida.set(cpf, { cotas: r.referencia, valorCota: Math.round((r.valor / r.referencia) * 100) / 100 });
  }
  return saida;
}

/**
 * Ajuda de custo por CPF (rubricas "AJUDA DE CUSTO", ex. 202 e 213) da folha do
 * contador mais recente antes da competência. É valor fixo combinado, faz parte
 * da folha oficial e o ponto não diz quanto é (03/11/2026). Fora do INSS/FGTS.
 */
export async function ajudaCustoPorCpf(
  cpfs: string[],
  comp: string,
): Promise<Map<string, { codigo: string; descricao: string; valor: number }[]>> {
  const saida = new Map<string, { codigo: string; descricao: string; valor: number }[]>();
  if (cpfs.length === 0) return saida;
  const linhas = await db
    .select({ cpf: schema.folhaContador.cpf, rubricas: schema.folhaContador.rubricas })
    .from(schema.folhaContador)
    .where(and(lt(schema.folhaContador.competencia, comp), inArray(schema.folhaContador.cpf, cpfs)))
    .orderBy(desc(schema.folhaContador.competencia));
  const vistos = new Set<string>();
  const alvo = new Set(cpfs);
  for (const l of linhas) {
    const cpf = String(l.cpf ?? '').replace(/\D/g, '');
    if (!alvo.has(cpf) || vistos.has(cpf)) continue;
    vistos.add(cpf);
    const rs = ((l.rubricas as { codigo: string; descricao: string; tipo: string; valor: number }[] | null) ?? []).filter(
      (x) => x.tipo === 'P' && x.valor > 0 && /AJUDA\s+DE\s+CUSTO/i.test(x.descricao ?? ''),
    );
    if (rs.length) saida.set(cpf, rs.map((x) => ({ codigo: x.codigo, descricao: x.descricao, valor: x.valor })));
  }
  return saida;
}

/**
 * Plano de saúde por CPF (desconto "PLANO DE SAUDE", ex. 8111) da última folha
 * do contador antes da competência. Valor fixo do mês (dono 09/11/2026: Yago e
 * Márcia saíam sem o desconto na nossa folha).
 */
export async function planoSaudePorCpf(
  cpfs: string[],
  comp: string,
): Promise<Map<string, { codigo: string; descricao: string; valor: number }[]>> {
  const saida = new Map<string, { codigo: string; descricao: string; valor: number }[]>();
  if (cpfs.length === 0) return saida;
  const linhas = await db
    .select({ cpf: schema.folhaContador.cpf, rubricas: schema.folhaContador.rubricas })
    .from(schema.folhaContador)
    .where(and(lt(schema.folhaContador.competencia, comp), inArray(schema.folhaContador.cpf, cpfs)))
    .orderBy(desc(schema.folhaContador.competencia));
  const vistos = new Set<string>();
  const alvo = new Set(cpfs);
  for (const l of linhas) {
    const cpf = String(l.cpf ?? '').replace(/\D/g, '');
    if (!alvo.has(cpf) || vistos.has(cpf)) continue;
    vistos.add(cpf);
    const rs = ((l.rubricas as { codigo: string; descricao: string; tipo: string; valor: number }[] | null) ?? []).filter(
      (x) => x.tipo === 'D' && x.valor > 0 && /PLANO\s+(DE\s+)?SA[UÚ]DE/i.test(x.descricao ?? ''),
    );
    if (rs.length) saida.set(cpf, rs.map((x) => ({ codigo: x.codigo, descricao: x.descricao, valor: x.valor })));
  }
  return saida;
}

/**
 * Quebra de caixa por CPF (rubrica "QUEBRA DE CAIXA", ex. 221 CLT e 8907
 * intermitente) da última folha do contador antes da competência. Referência
 * é o % (6); no intermitente o contador paga valor fixo (6% do mínimo).
 */
export async function quebraCaixaPorCpf(
  cpfs: string[],
  comp: string,
): Promise<Map<string, { codigo: string; descricao: string; referencia: number; valor: number }>> {
  const saida = new Map<string, { codigo: string; descricao: string; referencia: number; valor: number }>();
  if (cpfs.length === 0) return saida;
  const linhas = await db
    .select({ cpf: schema.folhaContador.cpf, rubricas: schema.folhaContador.rubricas })
    .from(schema.folhaContador)
    .where(and(lt(schema.folhaContador.competencia, comp), inArray(schema.folhaContador.cpf, cpfs)))
    .orderBy(desc(schema.folhaContador.competencia));
  const vistos = new Set<string>();
  const alvo = new Set(cpfs);
  for (const l of linhas) {
    const cpf = String(l.cpf ?? '').replace(/\D/g, '');
    if (!alvo.has(cpf) || vistos.has(cpf)) continue;
    vistos.add(cpf);
    const r = ((l.rubricas as { codigo: string; descricao: string; referencia?: number; tipo: string; valor: number }[] | null) ?? []).find(
      (x) => x.tipo === 'P' && x.valor > 0 && /QUEBRA\s+DE\s+CAIXA/i.test(x.descricao ?? ''),
    );
    if (r) saida.set(cpf, { codigo: r.codigo, descricao: r.descricao, referencia: Number(r.referencia) || 0, valor: Number(r.valor) });
  }
  // Sem folha do contador (dono 06/11/2026: "esquece o contador ... tem que ter
  // a quebra de caixa, quem for de caixa"): quem tem "caixa" no cargo do
  // cadastro recebe 6% — CLT sobre os dias pagos, intermitente 6% do salário
  // mínimo (o mesmo que o contador pagava: Arleide 100,20, Matheus 97,26).
  const faltam = cpfs.filter((c) => !saida.has(c));
  if (faltam.length > 0) {
    const caixas = await db
      .select({ cpf: schema.funcionario.cpf, cargo: schema.funcionario.cargo, cargoRegistro: schema.funcionario.cargoRegistro })
      .from(schema.funcionario)
      .where(inArray(schema.funcionario.cpf, faltam));
    for (const f of caixas) {
      const cpf = f.cpf ?? '';
      if (!cpf || saida.has(cpf)) continue;
      if (!/caixa/i.test(`${f.cargo ?? ''} ${f.cargoRegistro ?? ''}`)) continue;
      saida.set(cpf, { codigo: '221', descricao: 'QUEBRA DE CAIXA', referencia: 6, valor: Math.round(SALARIO_MINIMO_2026 * 6) / 100 });
    }
  }
  return saida;
}

/**
 * Minutos do mês por CPF e por casa — pra dividir o custo de quem trabalha em
 * mais de uma casa (rateio da E.B. pelas horas). Mesma regra de
 * horasDoMesPorCpf: no dia em que o Stelanto tem hora vale ele (casa = equipe
 * do Stelanto); nos outros, o ponto próprio. Conta o dia mesmo sem intervalo
 * batido: aqui importa ONDE a pessoa trabalhou, não se o dia já está liberado.
 */
export async function minutosPorCasaDoMes(cpfs: string[], ini: string, fim: string): Promise<Map<string, Map<string, number>>> {
  const saida = new Map<string, Map<string, number>>();
  if (cpfs.length === 0) return saida;
  // chave cpf|dia → casa → minutos
  const doPonto = new Map<string, Map<string, number>>();
  const doStelanto = new Map<string, Map<string, number>>();
  const somar = (m: Map<string, Map<string, number>>, k: string, filialId: string, min: number) => {
    const c = m.get(k) ?? new Map<string, number>();
    c.set(filialId, (c.get(filialId) ?? 0) + min);
    m.set(k, c);
  };

  const funcs = await db
    .select({ id: schema.funcionario.id, cpf: schema.funcionario.cpf })
    .from(schema.funcionario)
    .where(inArray(schema.funcionario.cpf, cpfs));
  if (funcs.length) {
    const cpfDoFunc = new Map(funcs.map((f) => [f.id, f.cpf as string]));
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
      const [funcId, filialId, dia] = k.split('|') as [string, string, string];
      const min = calcularDia(lista).totalMin;
      const cpf = cpfDoFunc.get(funcId);
      if (min > 0 && cpf) somar(doPonto, `${cpf}|${dia}`, filialId, min);
    }
  }

  const dias = await db
    .select({
      cpf: schema.stelantoColaborador.cpf,
      filialId: schema.stelantoColaborador.filialId,
      dia: schema.stelantoDia.dia,
      trabalhadoSeg: schema.stelantoDia.trabalhadoSeg,
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
    if (!d.cpf || !d.filialId || d.trabalhadoSeg <= 0) continue;
    somar(doStelanto, `${d.cpf}|${d.dia}`, d.filialId, d.trabalhadoSeg / 60);
  }

  for (const k of new Set([...doPonto.keys(), ...doStelanto.keys()])) {
    const cpf = k.split('|')[0]!;
    const casas = doStelanto.get(k) ?? doPonto.get(k)!;
    const porCasa = saida.get(cpf) ?? new Map<string, number>();
    for (const [filialId, min] of casas) porCasa.set(filialId, (porCasa.get(filialId) ?? 0) + min);
    saida.set(cpf, porCasa);
  }
  return saida;
}

/**
 * Atestados (funcionario_atestado, não cancelados) por CPF que tocam o mês — busca
 * desde 60 dias antes pra saber em que dia do afastamento o mês começa (16º dia em
 * diante = INSS). Soma as casas do mesmo CPF.
 */
export async function afastamentosPorCpf(
  cpfs: string[],
  ini: string,
  fim: string,
): Promise<Map<string, { inicio: string; fim: string }[]>> {
  const saida = new Map<string, { inicio: string; fim: string }[]>();
  if (cpfs.length === 0) return saida;
  const [a, m, d] = ini.split('-').map(Number);
  const desde = new Date(Date.UTC(a!, m! - 1, d! - 60)).toISOString().slice(0, 10);
  const linhas = await db
    .select({ cpf: schema.funcionario.cpf, inicio: schema.funcionarioAtestado.dataInicio, fim: schema.funcionarioAtestado.dataFim })
    .from(schema.funcionarioAtestado)
    .innerJoin(schema.funcionario, eq(schema.funcionario.id, schema.funcionarioAtestado.funcionarioId))
    .where(
      and(
        inArray(schema.funcionario.cpf, cpfs),
        isNull(schema.funcionarioAtestado.canceladoEm),
        lte(schema.funcionarioAtestado.dataInicio, fim),
        gte(schema.funcionarioAtestado.dataFim, desde),
      ),
    );
  for (const l of linhas) {
    if (!l.cpf) continue;
    const lista = saida.get(l.cpf) ?? [];
    lista.push({ inicio: l.inicio, fim: l.fim });
    saida.set(l.cpf, lista);
  }
  return saida;
}
