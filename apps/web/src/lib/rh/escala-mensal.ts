// Escala do mês dia a dia (pedido do dono 19/10/2026, Tabuará): 6x1 com uma
// folga fixa na semana, mas quem folga o domingo NÃO folga na semana — então a
// escala muda todo mês e é feita na grade de /rh/escala-mensal. O VT conta os
// dias de trabalho dela (lib/rh/vale-transporte.ts).
//
// Sugestão (o que a grade mostra antes de salvar):
//   folga fixa  = dia sem horas da jornada fixa; sem jornada fixa, o dia de
//                 seg–sáb em que a pessoa mais faltou ao ponto nas 4 semanas
//                 até hoje (mês passado: até o fim dele)
//   domingo     = CCT SINDHOTRE×SEHASE cl.16: homem folga 1 domingo depois de
//                 5 trabalhados; mulher a cada 2 semanas (CLT 386). Na semana
//                 em que folga o domingo, trabalha o dia da folga fixa.
//   O último domingo de folga vem da escala salva; sem ela, do ponto.

import { db, schema } from '@concilia/db';
import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { diaDaSemana, jornadaNoDia, minutosPrevistos } from '@/lib/rh/banco-horas';
import { somarDias } from '@/lib/rh/dia-operacional';
import { diasDoMes, sugerirMes, type Sexo } from '@/lib/rh/escala-mensal-regras';

export * from '@/lib/rh/escala-mensal-regras';

export interface PessoaEscala {
  funcionarioId: string;
  nome: string;
  cargo: string | null;
  sexo: Sexo | null;
  /** R$ do dia do VT, quando ativo. */
  vtDia: number | null;
  /** 1 = seg … 6 = sáb; null = não deu pra saber. */
  folgaFixa: number | null;
  /** Último domingo de folga antes do mês (escala salva ou ponto). */
  ultimoDomingoFolga: string | null;
  /** dia → true = folga, false = trabalha (o que está salvo). */
  salvo: Record<string, boolean>;
  /** dia → sugestão (só dias na casa). */
  sugestao: Record<string, boolean>;
  /** Dias do mês com batida no ponto (até hoje). */
  ponto: string[];
  /** Dias fora da casa (antes da admissão / depois do desligamento). */
  foraDaCasa: string[];
}

export interface EscalaMes {
  mes: string; // YYYY-MM
  dias: string[];
  pessoas: PessoaEscala[];
}

export async function montarEscalaMes(filialId: string, mes: string, hoje: string): Promise<EscalaMes> {
  const dias = diasDoMes(mes);
  const inicio = dias[0];
  const fim = dias[dias.length - 1];
  // Folga fixa pelo jeito atual: as 4 semanas até hoje (mês passado: até o fim dele).
  const depoisDoFim = somarDias(fim, 1);
  const refPonto = depoisDoFim < hoje ? depoisDoFim : hoje;
  const janelaIni = somarDias(refPonto, -28);
  const janelaDomIni = somarDias(inicio, -7 * 8);

  const funcionarios = await db
    .select({
      id: schema.funcionario.id,
      nome: schema.funcionario.nome,
      cargo: schema.funcionario.cargo,
      sexo: schema.funcionario.sexo,
      dataAdmissao: schema.funcionario.dataAdmissao,
      dataDesligamento: schema.funcionario.dataDesligamento,
    })
    .from(schema.funcionario)
    .where(and(eq(schema.funcionario.filialId, filialId), eq(schema.funcionario.ativo, true)))
    .orderBy(asc(schema.funcionario.nome));
  const ids = funcionarios.map((f) => f.id);
  if (!ids.length) return { mes, dias, pessoas: [] };

  const janelaPontoIni = janelaDomIni < janelaIni ? janelaDomIni : janelaIni;
  const [salvos, domingosSalvos, vts, vigRows, pontoDias, stelantoDias] = await Promise.all([
    db
      .select({ funcionarioId: schema.rhEscalaDia.funcionarioId, dia: schema.rhEscalaDia.dia, folga: schema.rhEscalaDia.folga })
      .from(schema.rhEscalaDia)
      .where(and(inArray(schema.rhEscalaDia.funcionarioId, ids), gte(schema.rhEscalaDia.dia, inicio), lte(schema.rhEscalaDia.dia, fim))),
    // Último domingo de folga salvo antes do mês.
    db
      .select({
        funcionarioId: schema.rhEscalaDia.funcionarioId,
        dia: sql<string>`max(${schema.rhEscalaDia.dia})::text`,
      })
      .from(schema.rhEscalaDia)
      .where(
        and(
          inArray(schema.rhEscalaDia.funcionarioId, ids),
          lt(schema.rhEscalaDia.dia, inicio),
          eq(schema.rhEscalaDia.folga, true),
          sql`extract(dow from ${schema.rhEscalaDia.dia}) = 0`,
        ),
      )
      .groupBy(schema.rhEscalaDia.funcionarioId),
    db.select().from(schema.vtPessoa).where(inArray(schema.vtPessoa.funcionarioId, ids)),
    db
      .select({
        funcionarioId: schema.funcionarioJornada.funcionarioId,
        vigenteDesde: schema.funcionarioJornada.vigenteDesde,
        jornadaId: schema.rhJornada.id,
        nome: schema.rhJornada.nome,
        tipo: schema.rhJornada.tipo,
        minSeg: schema.rhJornada.minSeg,
        minTer: schema.rhJornada.minTer,
        minQua: schema.rhJornada.minQua,
        minQui: schema.rhJornada.minQui,
        minSex: schema.rhJornada.minSex,
        minSab: schema.rhJornada.minSab,
        minDom: schema.rhJornada.minDom,
      })
      .from(schema.funcionarioJornada)
      .innerJoin(schema.rhJornada, eq(schema.rhJornada.id, schema.funcionarioJornada.jornadaId))
      .where(inArray(schema.funcionarioJornada.funcionarioId, ids)),
    // Dia com batida em qualquer casa (ponto próprio + Stelanto antes da virada).
    db
      .selectDistinct({ funcionarioId: schema.pontoBatida.funcionarioId, dia: schema.pontoBatida.diaOperacional })
      .from(schema.pontoBatida)
      .where(
        and(
          inArray(schema.pontoBatida.funcionarioId, ids),
          gte(schema.pontoBatida.diaOperacional, janelaPontoIni),
          lte(schema.pontoBatida.diaOperacional, fim),
          isNull(schema.pontoBatida.excluidaEm),
        ),
      ),
    db
      .selectDistinct({ funcionarioId: schema.stelantoColaborador.funcionarioId, dia: schema.stelantoDia.dia })
      .from(schema.stelantoDia)
      .innerJoin(schema.stelantoColaborador, eq(schema.stelantoColaborador.id, schema.stelantoDia.colaboradorId))
      .where(
        and(
          inArray(schema.stelantoColaborador.funcionarioId, ids),
          gte(schema.stelantoDia.dia, janelaPontoIni),
          lte(schema.stelantoDia.dia, fim),
          sql`${schema.stelantoDia.trabalhadoSeg} > 0`,
        ),
      ),
  ]);

  const pontoPor = new Map<string, Set<string>>();
  for (const r of [...pontoDias, ...stelantoDias]) {
    if (!r.funcionarioId) continue;
    const s = pontoPor.get(r.funcionarioId) ?? new Set<string>();
    s.add(r.dia);
    pontoPor.set(r.funcionarioId, s);
  }
  const vtPor = new Map(vts.map((v) => [v.funcionarioId, v]));
  const domSalvoPor = new Map(domingosSalvos.map((d) => [d.funcionarioId, d.dia]));

  const pessoas = funcionarios.map((f, idx): PessoaEscala => {
    const naCasa = (d: string) =>
      (!f.dataAdmissao || d >= f.dataAdmissao) && (!f.dataDesligamento || d <= f.dataDesligamento);
    const ponto = pontoPor.get(f.id) ?? new Set<string>();
    const sexo = f.sexo === 'H' || f.sexo === 'M' ? (f.sexo as Sexo) : null;

    // Folga fixa: jornada fixa vigente no meio do mês → 1º dia de seg–sáb sem horas.
    let folgaFixa: number | null = null;
    const vig = jornadaNoDia(vigRows.filter((v) => v.funcionarioId === f.id), dias[14]);
    if (vig?.tipo === 'fixa') {
      for (let w = 1; w <= 6; w++) {
        const exemplo = dias.find((d) => diaDaSemana(d) === w)!;
        if (minutosPrevistos(vig, exemplo) === 0) {
          folgaFixa = w;
          break;
        }
      }
    }
    if (folgaFixa == null) {
      // Pelo ponto: dia de seg–sáb que mais ficou sem batida nas semanas em que trabalhou.
      const faltas = [0, 0, 0, 0, 0, 0, 0];
      let semanasComPonto = 0;
      for (let d = janelaIni; d < refPonto; d = somarDias(d, 7)) {
        const semana = Array.from({ length: 7 }, (_, i) => somarDias(d, i)).filter((x) => x < refPonto);
        if (!semana.some((x) => ponto.has(x))) continue;
        semanasComPonto++;
        for (const x of semana) if (!ponto.has(x)) faltas[diaDaSemana(x)]++;
      }
      let melhor = 0;
      for (let w = 1; w <= 6; w++) if (faltas[w] > melhor) { melhor = faltas[w]; folgaFixa = w; }
      if (!semanasComPonto) folgaFixa = null;
    }

    // Último domingo de folga: escala salva; senão o ponto (domingo sem batida
    // numa semana em que a pessoa trabalhou).
    let ultimoDomingoFolga = domSalvoPor.get(f.id) ?? null;
    if (!ultimoDomingoFolga) {
      for (let d = somarDias(inicio, -1); d >= janelaDomIni; d = somarDias(d, -1)) {
        if (diaDaSemana(d) !== 0 || d >= hoje) continue;
        const semana = Array.from({ length: 7 }, (_, i) => somarDias(d, -i));
        if (!ponto.has(d) && semana.some((x) => ponto.has(x)) && naCasa(d)) {
          ultimoDomingoFolga = d;
          break;
        }
      }
    }

    const sugestao = sugerirMes(dias, folgaFixa, sexo, ultimoDomingoFolga, idx, new Set(dias.filter((d) => !naCasa(d))));

    const salvo: Record<string, boolean> = {};
    for (const s of salvos) if (s.funcionarioId === f.id) salvo[s.dia] = s.folga;

    const vt = vtPor.get(f.id);
    return {
      funcionarioId: f.id,
      nome: f.nome,
      cargo: f.cargo,
      sexo,
      vtDia: vt?.ativo && Number(vt.valorDia) > 0 ? Number(vt.valorDia) : null,
      folgaFixa,
      ultimoDomingoFolga,
      salvo,
      sugestao,
      ponto: dias.filter((d) => ponto.has(d)),
      foraDaCasa: dias.filter((d) => !naCasa(d)),
    };
  });

  return { mes, dias, pessoas };
}

/** Dias de trabalho (folga=false) da escala salva por pessoa num intervalo. */
export async function diasTrabalhoEscala(ids: string[], inicio: string, fim: string): Promise<Map<string, { trabalho: Set<string>; comLinha: number }>> {
  const out = new Map<string, { trabalho: Set<string>; comLinha: number }>();
  if (!ids.length) return out;
  const rows = await db
    .select({ funcionarioId: schema.rhEscalaDia.funcionarioId, dia: schema.rhEscalaDia.dia, folga: schema.rhEscalaDia.folga })
    .from(schema.rhEscalaDia)
    .where(and(inArray(schema.rhEscalaDia.funcionarioId, ids), gte(schema.rhEscalaDia.dia, inicio), lte(schema.rhEscalaDia.dia, fim)));
  for (const r of rows) {
    const x = out.get(r.funcionarioId) ?? { trabalho: new Set<string>(), comLinha: 0 };
    x.comLinha++;
    if (!r.folga) x.trabalho.add(r.dia);
    out.set(r.funcionarioId, x);
  }
  return out;
}
