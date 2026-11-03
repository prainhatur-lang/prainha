// Rateio do líquido da folha da E.B. pelas horas de cada casa (pedido do dono,
// 03/11/2026). Hoje cada pessoa pesa 100% na casa do cadastro; aqui o líquido
// de quem trabalhou em mais de uma casa é dividido pela proporção das horas
// batidas no ponto em cada uma. Quem não tem ponto no mês (administrativo)
// fica 100% na casa do cadastro.
//
// rateioFolhaPelasHoras: só leitura, quadro ao lado do encontro de contas.
// proporcaoPelasHoras (fim do arquivo): opção de % nas guias da E.B.

import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';
import { minutosPorCasaDoMes } from '@/lib/rh/folha-mensal-dados';

export interface PessoaRateioHoras {
  folhaId: string;
  funcionarioId: string | null;
  nome: string;
  cadastroFilialId: string;
  liquido: number;
  /** Minutos e valor por casa (vazio = sem ponto no mês → 100% no cadastro). */
  casas: { filialId: string; min: number; valor: number }[];
}

export interface CasaRateioHoras {
  filialId: string;
  /** Líquido de quem é cadastrado na casa (o jeito de hoje). */
  peloCadastro: number;
  /** Líquido pelas horas trabalhadas na casa. */
  pelasHoras: number;
  /** pelasHoras − peloCadastro: positivo = a casa deve repassar a mais. */
  diferenca: number;
}

function ultimoDia(comp: string): string {
  const [a, m] = comp.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${comp}-${String(d).padStart(2, '0')}`;
}

export async function rateioFolhaPelasHoras(
  cnpj: string,
  competencia: string,
  filialIds: string[],
): Promise<{ pessoas: PessoaRateioHoras[]; casas: CasaRateioHoras[] }> {
  const folha = (
    await db
      .select({
        id: schema.folhaContador.id,
        filialId: schema.folhaContador.filialId,
        funcionarioId: schema.folhaContador.funcionarioId,
        nome: schema.folhaContador.nome,
        cpf: schema.folhaContador.cpf,
        liquido: schema.folhaContador.liquido,
      })
      .from(schema.folhaContador)
      .where(and(eq(schema.folhaContador.cnpj, cnpj), eq(schema.folhaContador.competencia, competencia)))
      .orderBy(asc(schema.folhaContador.nome))
  ).filter((f) => filialIds.includes(f.filialId) && Number(f.liquido) > 0);

  const cpfDe = (c: string | null) => String(c ?? '').replace(/\D/g, '');
  const cpfs = [...new Set(folha.map((f) => cpfDe(f.cpf)).filter((c) => c.length === 11))];
  const minutos = await minutosPorCasaDoMes(cpfs, `${competencia}-01`, ultimoDia(competencia));

  const pessoas: PessoaRateioHoras[] = folha.map((f) => {
    const liquido = Number(f.liquido);
    const porCasa = [...(minutos.get(cpfDe(f.cpf))?.entries() ?? [])]
      .filter(([, m]) => m > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = porCasa.reduce((t, [, m]) => t + m, 0);
    if (total <= 0) return { folhaId: f.id, funcionarioId: f.funcionarioId, nome: f.nome, cadastroFilialId: f.filialId, liquido, casas: [] };
    // Divide em centavos; a casa com mais horas fica com o resto do arredondamento.
    const cents = Math.round(liquido * 100);
    const partes = porCasa.map(([filialId, min]) => ({ filialId, min, c: Math.floor((cents * min) / total) }));
    partes[0]!.c += cents - partes.reduce((t, p) => t + p.c, 0);
    return {
      folhaId: f.id,
      funcionarioId: f.funcionarioId,
      nome: f.nome,
      cadastroFilialId: f.filialId,
      liquido,
      casas: partes.map((p) => ({ filialId: p.filialId, min: p.min, valor: p.c / 100 })),
    };
  });

  const acum = new Map<string, { cad: number; horas: number }>();
  const soma = (id: string, campo: 'cad' | 'horas', c: number) => {
    const a = acum.get(id) ?? { cad: 0, horas: 0 };
    a[campo] += c;
    acum.set(id, a);
  };
  for (const p of pessoas) {
    soma(p.cadastroFilialId, 'cad', Math.round(p.liquido * 100));
    if (p.casas.length === 0) soma(p.cadastroFilialId, 'horas', Math.round(p.liquido * 100));
    else for (const c of p.casas) soma(c.filialId, 'horas', Math.round(c.valor * 100));
  }
  const casas = [...acum.entries()]
    .map(([filialId, a]) => ({
      filialId,
      peloCadastro: a.cad / 100,
      pelasHoras: a.horas / 100,
      diferenca: (a.horas - a.cad) / 100,
    }))
    .sort((a, b) => b.pelasHoras - a.pelasHoras);
  return { pessoas, casas };
}

// ───────── % pelas horas pras guias (FGTS/INSS) da E.B. ─────────
// Pedido do dono 03/11/2026 ("Sim, nas guias"). O peso de cada pessoa é o que
// a guia cobra dela (FGTS → valor do FGTS; INSS → base do INSS; outros →
// proventos), dividido pelas horas de cada casa. Sem ponto no mês → 100% na
// casa do cadastro. É uma OPÇÃO a mais na tela da guia: a proposta de hoje
// (rateio do contador / FGTS por departamento) continua sendo a padrão.

export interface ProporcaoHoras {
  competenciaUsada: string;
  base: 'fgts' | 'inss' | 'proventos';
  percentuais: Array<{ filialId: string; percentual: number }>;
  /** Peso (R$) de cada casa pelas horas e pelo cadastro, pra mostrar ao lado. */
  partes: Array<{ filialId: string; pelasHoras: number; peloCadastro: number }>;
  /** Quem trabalhou fora da casa do cadastro (pra explicar a diferença). */
  divididos: number;
}

export async function proporcaoPelasHoras(
  cnpj: string,
  competencia: string | null,
  tipo: string | null,
): Promise<ProporcaoHoras | null> {
  const fc = schema.folhaContador;
  // competência da guia; se não importada, a última antes dela; senão a primeira
  const comps = (
    await db.selectDistinct({ c: fc.competencia }).from(fc).where(eq(fc.cnpj, cnpj)).orderBy(asc(fc.competencia))
  ).map((r) => r.c);
  if (comps.length === 0) return null;
  const comp = competencia
    ? ([...comps].reverse().find((c) => c <= competencia) ?? comps[0]!)
    : comps[comps.length - 1]!;

  const linhas = await db
    .select({
      filialId: fc.filialId,
      cpf: fc.cpf,
      valorFgts: fc.valorFgts,
      baseInss: fc.baseInss,
      proventos: fc.proventos,
    })
    .from(fc)
    .where(and(eq(fc.cnpj, cnpj), eq(fc.competencia, comp)));

  const peso = (l: (typeof linhas)[number], b: 'fgts' | 'inss' | 'proventos') =>
    Number((b === 'fgts' ? l.valorFgts : b === 'inss' ? l.baseInss : l.proventos) ?? 0);
  let base: 'fgts' | 'inss' | 'proventos' = tipo === 'FGTS' ? 'fgts' : tipo === 'INSS' ? 'inss' : 'proventos';
  if (linhas.reduce((t, l) => t + peso(l, base), 0) <= 0) base = 'proventos';

  const cpfDe = (c: string | null) => String(c ?? '').replace(/\D/g, '');
  const cpfs = [...new Set(linhas.map((l) => cpfDe(l.cpf)).filter((c) => c.length === 11))];
  const minutos = await minutosPorCasaDoMes(cpfs, `${comp}-01`, ultimoDia(comp));

  const horas = new Map<string, number>();
  const cad = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  let divididos = 0;
  for (const l of linhas) {
    const w = peso(l, base);
    if (w <= 0) continue;
    add(cad, l.filialId, w);
    const porCasa = [...(minutos.get(cpfDe(l.cpf))?.entries() ?? [])].filter(([, m]) => m > 0);
    const total = porCasa.reduce((t, [, m]) => t + m, 0);
    if (total <= 0) {
      add(horas, l.filialId, w);
      continue;
    }
    if (porCasa.some(([f]) => f !== l.filialId)) divididos++;
    for (const [f, m] of porCasa) add(horas, f, (w * m) / total);
  }
  const tot = [...horas.values()].reduce((t, v) => t + v, 0);
  if (tot <= 0) return null;
  const ids = [...new Set([...horas.keys(), ...cad.keys()])];
  const percentuais = ids
    .map((filialId) => ({ filialId, percentual: Math.round(((horas.get(filialId) ?? 0) / tot) * 10000) / 100 }))
    .filter((p) => p.percentual > 0)
    .sort((a, b) => b.percentual - a.percentual);
  // fecha 100% na maior casa
  const soma = Math.round(percentuais.reduce((t, p) => t + p.percentual, 0) * 100) / 100;
  if (percentuais.length && soma !== 100) percentuais[0]!.percentual = Math.round((percentuais[0]!.percentual + 100 - soma) * 100) / 100;
  return {
    competenciaUsada: comp,
    base,
    percentuais,
    partes: ids.map((filialId) => ({
      filialId,
      pelasHoras: Math.round((horas.get(filialId) ?? 0) * 100) / 100,
      peloCadastro: Math.round((cad.get(filialId) ?? 0) * 100) / 100,
    })),
    divididos,
  };
}
