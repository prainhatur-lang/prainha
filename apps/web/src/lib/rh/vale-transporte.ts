// Vale transporte quinzenal (pedido do dono 18/10/2026): paga adiantado de
// 01 a 15 e de 16 ao fim do mês; na quinzena seguinte o ponto diz quantos dias
// a pessoa trabalhou e a diferença entra como acerto na nova previsão.
//
//   previsto  = dias previstos × valor do dia
//   pago      = max(0, previsto + acerto que vinha)
//   saldo     = acerto que vinha + dias no ponto × valor do dia − pago
//   (saldo + = a casa ainda deve; − = pagou a mais, abate na seguinte)
//
// Dias previstos: escala fixa (rh_jornada) → dias com horas na quinzena;
// sem escala fixa → "dias por semana" do VT da pessoa; sem isso → os dias que
// ela trabalhou na quinzena anterior. A tela deixa editar antes de pagar.
// Dias trabalhados: ponto próprio (qualquer casa) e, antes da virada, o Stelanto.
//
// Desconto de 6% (Lei 7.418/85): sai do salário, limitado ao VT que a pessoa
// recebeu na quinzena. Base: CLT mensal = metade do salário (proporcional aos
// dias na casa); intermitente = valor da hora × horas do ponto na quinzena —
// por isso o desconto é lido ao vivo e só fecha quando a quinzena termina.
// Quem recebe em DINHEIRO (ajuda de custo) não tem desconto.

import { db, schema } from '@concilia/db';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { jornadaNoDia, minutosPrevistos, type VigenciaJornada } from '@/lib/rh/banco-horas';
import { somarDias } from '@/lib/rh/dia-operacional';
import { calcularDia } from '@/lib/rh/calcular-ponto';

export const DESCONTO_VT = 0.06;

export interface Quinzena {
  inicio: string;
  fim: string;
}

function ultimoDiaMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Quinzena que contém o dia (YYYY-MM-DD). */
export function quinzenaDe(ymd: string): Quinzena {
  const [a, m, d] = ymd.split('-').map(Number);
  const mm = String(m).padStart(2, '0');
  if (d <= 15) return { inicio: `${a}-${mm}-01`, fim: `${a}-${mm}-15` };
  return { inicio: `${a}-${mm}-16`, fim: `${a}-${mm}-${ultimoDiaMes(a, m)}` };
}

export function quinzenaAnterior(q: Quinzena): Quinzena {
  return quinzenaDe(somarDias(q.inicio, -1));
}

export function quinzenaSeguinte(q: Quinzena): Quinzena {
  return quinzenaDe(somarDias(q.fim, 1));
}

export function diasDaQuinzena(q: Quinzena): string[] {
  const out: string[] = [];
  for (let d = q.inicio; d <= q.fim; d = somarDias(d, 1)) out.push(d);
  return out;
}

export function nomeQuinzena(q: Quinzena): string {
  const f = (s: string) => s.split('-').reverse().slice(0, 2).join('/');
  return `${f(q.inicio)} a ${f(q.fim)}`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function valorPagar(previsto: number, acerto: number): number {
  return r2(Math.max(0, previsto + acerto));
}

/** 6% da base, nunca mais que o VT recebido. */
export type FormaVt = 'folha' | 'dinheiro';

export function descontoVt(base: number, vtRecebido: number): number {
  return r2(Math.max(0, Math.min(base * DESCONTO_VT, vtRecebido)));
}

export type OrigemPrevisao = 'escala' | 'dias_semana' | 'quinzena_anterior' | 'nenhuma';

export interface LinhaVt {
  funcionarioId: string;
  nome: string;
  cargo: string | null;
  regime: string | null;
  vt: { ativo: boolean; valorDia: number; diasSemana: number | null; forma: FormaVt } | null;
  jornadaNome: string | null;
  diasPrevistos: number;
  origemPrevisao: OrigemPrevisao;
  /** Quinzena anterior paga: o que foi pago × o que o ponto mostrou. */
  anterior: {
    valorDia: number;
    diasPagos: number;
    diasPonto: number;
    acertoQueVinha: number;
    valorPago: number;
    saldo: number;
    /** 6% sobre a quinzena anterior (já terminada). */
    desconto: number;
    baseDesconto: { valor: number; como: string } | null;
  } | null;
  /** Dias com batida nesta quinzena (até hoje). */
  diasPontoAtual: number;
  /** Base do desconto de 6%: CLT = salário/2 proporcional; intermitente = hora × horas do ponto. */
  baseDesconto: { valor: number; como: string } | null;
  /** Já paga nesta quinzena (valores congelados). */
  paga: {
    valorDia: number;
    diasPrevistos: number;
    valorPrevisto: number;
    acertoAnterior: number;
    valorPago: number;
    forma: FormaVt;
    descontoValor: number | null;
  } | null;
}

export interface QuinzenaVt {
  quinzena: Quinzena;
  anterior: Quinzena;
  paga: { id: string; pagaEm: Date } | null;
  anteriorPaga: boolean;
  seguintePaga: boolean;
  linhas: LinhaVt[];
}

export async function montarQuinzenaVt(filialId: string, q: Quinzena): Promise<QuinzenaVt> {
  const ant = quinzenaAnterior(q);
  const seg = quinzenaSeguinte(q);

  const quinzenas = await db
    .select({ id: schema.vtQuinzena.id, inicio: schema.vtQuinzena.dataInicio, pagaEm: schema.vtQuinzena.pagaEm })
    .from(schema.vtQuinzena)
    .where(
      and(
        eq(schema.vtQuinzena.filialId, filialId),
        inArray(schema.vtQuinzena.dataInicio, [ant.inicio, q.inicio, seg.inicio]),
      ),
    );
  const qAtual = quinzenas.find((x) => x.inicio === q.inicio) ?? null;
  const qAnt = quinzenas.find((x) => x.inicio === ant.inicio) ?? null;
  const qSeg = quinzenas.find((x) => x.inicio === seg.inicio) ?? null;

  const itens = quinzenas.length
    ? await db
        .select()
        .from(schema.vtQuinzenaItem)
        .where(inArray(schema.vtQuinzenaItem.quinzenaId, quinzenas.map((x) => x.id)))
    : [];
  const itemAtual = new Map(itens.filter((i) => i.quinzenaId === qAtual?.id).map((i) => [i.funcionarioId, i]));
  const itemAnt = new Map(itens.filter((i) => i.quinzenaId === qAnt?.id).map((i) => [i.funcionarioId, i]));

  // Ativos da casa (lotação do cadastro) + quem já tem VT pago aqui e saiu depois.
  const idsComItem = [...new Set([...itemAtual.keys(), ...itemAnt.keys()])];
  const funcionarios = await db
    .select({
      id: schema.funcionario.id,
      nome: schema.funcionario.nome,
      cargo: schema.funcionario.cargo,
      regime: schema.funcionario.regimeSalarial,
      dataAdmissao: schema.funcionario.dataAdmissao,
      dataDesligamento: schema.funcionario.dataDesligamento,
      salarioBase: schema.funcionario.salarioBase,
    })
    .from(schema.funcionario)
    .where(
      idsComItem.length
        ? sql`(${schema.funcionario.filialId} = ${filialId} AND ${schema.funcionario.ativo}) OR ${inArray(schema.funcionario.id, idsComItem)}`
        : and(eq(schema.funcionario.filialId, filialId), eq(schema.funcionario.ativo, true)),
    )
    .orderBy(asc(schema.funcionario.nome));
  const ids = funcionarios.map((f) => f.id);
  if (!ids.length) {
    return { quinzena: q, anterior: ant, paga: qAtual, anteriorPaga: !!qAnt, seguintePaga: !!qSeg, linhas: [] };
  }

  const [vts, vigRows, batidas, stelanto, batidasQ] = await Promise.all([
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
    // Dia com batida em qualquer casa = dia trabalhado (VT é da pessoa).
    db
      .selectDistinct({ funcionarioId: schema.pontoBatida.funcionarioId, dia: schema.pontoBatida.diaOperacional })
      .from(schema.pontoBatida)
      .where(
        and(
          inArray(schema.pontoBatida.funcionarioId, ids),
          gte(schema.pontoBatida.diaOperacional, ant.inicio),
          lte(schema.pontoBatida.diaOperacional, q.fim),
          isNull(schema.pontoBatida.excluidaEm),
        ),
      ),
    // Antes da virada pro ponto próprio a fonte é o espelho do Stelanto.
    db
      .selectDistinct({ funcionarioId: schema.stelantoColaborador.funcionarioId, dia: schema.stelantoDia.dia })
      .from(schema.stelantoDia)
      .innerJoin(schema.stelantoColaborador, eq(schema.stelantoColaborador.id, schema.stelantoDia.colaboradorId))
      .where(
        and(
          inArray(schema.stelantoColaborador.funcionarioId, ids),
          gte(schema.stelantoDia.dia, ant.inicio),
          lte(schema.stelantoDia.dia, q.fim),
          sql`${schema.stelantoDia.trabalhadoSeg} > 0`,
        ),
      ),
    // Horas da quinzena e da anterior (base do desconto do intermitente).
    db
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
          inArray(schema.pontoBatida.funcionarioId, ids),
          gte(schema.pontoBatida.diaOperacional, ant.inicio),
          lte(schema.pontoBatida.diaOperacional, q.fim),
          isNull(schema.pontoBatida.excluidaEm),
        ),
      ),
  ]);

  const porCasaDia = new Map<string, { quando: Date; tipo: 'entrada' | 'saida' }[]>();
  for (const b of batidasQ) {
    const k = `${b.funcionarioId}|${b.dia}|${b.filialId}`;
    const lista = porCasaDia.get(k) ?? [];
    lista.push({ quando: b.quando, tipo: b.tipo as 'entrada' | 'saida' });
    porCasaDia.set(k, lista);
  }
  // funcionario|início da quinzena → minutos
  const minQ = new Map<string, number>();
  for (const [k, lista] of porCasaDia) {
    const [fid, dia] = k.split('|');
    const chave = `${fid}|${quinzenaDe(dia).inicio}`;
    minQ.set(chave, (minQ.get(chave) ?? 0) + calcularDia(lista).totalMin);
  }

  const diasTrab = new Map<string, Set<string>>();
  for (const b of [...batidas, ...stelanto]) {
    if (!b.funcionarioId) continue;
    const s = diasTrab.get(b.funcionarioId) ?? new Set<string>();
    s.add(b.dia);
    diasTrab.set(b.funcionarioId, s);
  }
  const contar = (fid: string, qq: Quinzena) => {
    let n = 0;
    for (const d of diasTrab.get(fid) ?? []) if (d >= qq.inicio && d <= qq.fim) n++;
    return n;
  };

  const vtPor = new Map(vts.map((v) => [v.funcionarioId, v]));
  const diasQ = diasDaQuinzena(q);

  const linhas: LinhaVt[] = funcionarios.map((f) => {
    const vigencias: VigenciaJornada[] = vigRows
      .filter((v) => v.funcionarioId === f.id)
      .map((v) => ({ ...v }));
    const jAtual = jornadaNoDia(vigencias, q.fim) ?? jornadaNoDia(vigencias, q.inicio);
    const vt = vtPor.get(f.id);
    const naCasa = (d: string) =>
      (!f.dataAdmissao || d >= f.dataAdmissao) && (!f.dataDesligamento || d <= f.dataDesligamento);

    let diasPrevistos = 0;
    let origemPrevisao: OrigemPrevisao = 'nenhuma';
    const temFixa = diasQ.some((d) => jornadaNoDia(vigencias, d)?.tipo === 'fixa');
    if (temFixa) {
      diasPrevistos = diasQ.filter((d) => {
        const j = jornadaNoDia(vigencias, d);
        return naCasa(d) && !!j && minutosPrevistos(j, d) > 0;
      }).length;
      origemPrevisao = 'escala';
    } else if (vt?.diasSemana) {
      diasPrevistos = Math.round((vt.diasSemana * diasQ.filter(naCasa).length) / 7);
      origemPrevisao = 'dias_semana';
    } else {
      const n = contar(f.id, ant);
      if (n > 0) {
        diasPrevistos = n;
        origemPrevisao = 'quinzena_anterior';
      }
    }

    const salario = f.salarioBase ? Number(f.salarioBase) : 0;
    const moeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const baseDe = (qq: Quinzena): LinhaVt['baseDesconto'] => {
      if (salario <= 0) return null;
      if (f.regime === 'clt_mensal') {
        const dq = diasDaQuinzena(qq);
        const naCasaQ = dq.filter(naCasa).length;
        return {
          valor: r2((salario / 2) * (naCasaQ / dq.length)),
          como: `salário ${moeda(salario)} ÷ 2${naCasaQ < dq.length ? ` × ${naCasaQ}/${dq.length} dias` : ''}`,
        };
      }
      if (f.regime === 'intermitente_hora') {
        const min = minQ.get(`${f.id}|${qq.inicio}`) ?? 0;
        return {
          valor: r2((min / 60) * salario),
          como: `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h × ${moeda(salario)}/h`,
        };
      }
      return null;
    };
    const baseDesconto = baseDe(q);

    const ia = itemAnt.get(f.id);
    const anterior = ia
      ? (() => {
          const valorDia = Number(ia.valorDia);
          const diasPonto = contar(f.id, ant);
          const acertoQueVinha = Number(ia.acertoAnterior);
          const valorPago = Number(ia.valorPago);
          return {
            valorDia,
            diasPagos: ia.diasPrevistos,
            diasPonto,
            acertoQueVinha,
            valorPago,
            saldo: r2(acertoQueVinha + diasPonto * valorDia - valorPago),
            // Gravado quando a quinzena atual foi paga; até lá, ao vivo.
            desconto:
              ia.descontoValor != null
                ? Number(ia.descontoValor)
                : ia.forma === 'dinheiro'
                  ? 0
                  : descontoVt(baseDe(ant)?.valor ?? 0, valorPago),
            baseDesconto:
              ia.descontoBase != null
                ? { valor: Number(ia.descontoBase), como: 'gravado' }
                : baseDe(ant),
          };
        })()
      : null;

    const ip = itemAtual.get(f.id);
    return {
      funcionarioId: f.id,
      nome: f.nome,
      cargo: f.cargo,
      regime: f.regime,
      vt: vt
        ? { ativo: vt.ativo, valorDia: Number(vt.valorDia), diasSemana: vt.diasSemana, forma: vt.forma as FormaVt }
        : null,
      jornadaNome: jAtual?.nome ?? null,
      diasPrevistos,
      origemPrevisao,
      anterior,
      diasPontoAtual: contar(f.id, q),
      baseDesconto,
      paga: ip
        ? {
            valorDia: Number(ip.valorDia),
            diasPrevistos: ip.diasPrevistos,
            valorPrevisto: Number(ip.valorPrevisto),
            acertoAnterior: Number(ip.acertoAnterior),
            valorPago: Number(ip.valorPago),
            forma: ip.forma as FormaVt,
            descontoValor: ip.descontoValor != null ? Number(ip.descontoValor) : null,
          }
        : null,
    };
  });

  return {
    quinzena: q,
    anterior: ant,
    paga: qAtual ? { id: qAtual.id, pagaEm: qAtual.pagaEm } : null,
    anteriorPaga: !!qAnt,
    seguintePaga: !!qSeg,
    linhas,
  };
}
