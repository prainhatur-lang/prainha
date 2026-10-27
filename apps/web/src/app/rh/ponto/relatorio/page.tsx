// Relatório mensal do ponto (25/10/2026): sintético (uma linha por pessoa) e
// analítico (dia a dia, com as batidas). Pessoas = cadastro da casa; as horas
// somam batidas de qualquer casa (igual ao banco de horas). Previsto e saldo
// seguem a jornada (mesma conta do /rh/banco-horas); falta usa a escala do mês
// quando existe, senão a jornada.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, gte, inArray, isNull, lte, eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { calcularDia, minutosNoturnos } from '@/lib/rh/calcular-ponto';
import { pontoProprioDesde } from '@/lib/rh/ponto-vigencia';
import { horaMinutoBr, somarDias } from '@/lib/rh/dia-operacional';
import { diaDaSemana, fmtHoras, fmtSaldo, jornadaNoDia, minutosPrevistos, type VigenciaJornada } from '@/lib/rh/banco-horas';
import { atestadosNoPeriodo, diasDeAtestado } from '@/lib/rh/atestado';
import { diasTrabalhoEscala } from '@/lib/rh/escala-mensal';
import { BotaoImprimir } from './imprimir';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  mes?: string;
  view?: string;
  pessoa?: string;
}

/** Tolerância de atraso na entrada (CLT art. 58 §1º: 5 min por marcação). */
const TOLERANCIA_ATRASO_MIN = 5;
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

type Situacao = 'ok' | 'falta' | 'incompleto' | 'atestado' | 'folga' | 'hoje' | 'fora' | 'extra' | 'menos';
/** Diferença do dia que não vira aviso (CLT art. 58 §1º: até 10 min por dia). */
const TOLERANCIA_DIA_MIN = 10;

interface BatidaDia {
  hora: string;
  tipo: 'entrada' | 'saida';
  origem: string;
  outraCasa: string | null;
  /** GPS da batida pelo celular (abre o mapa no 📱). */
  geoLat: number | null;
  geoLng: number | null;
  geoDistanciaM: number | null;
}

interface LinhaDia {
  dia: string;
  batidas: BatidaDia[];
  trabalhadoMin: number;
  /** Minutos entre 22:00 e 05:00 (relógio) e em hora noturna reduzida. */
  noturnoMin: number;
  noturnoFictoMin: number;
  previstoMin: number;
  saldoMin: number | null;
  situacoes: Situacao[];
  atrasoMin: number;
  atestado: string | null;
}

interface Resumo {
  id: string;
  nome: string;
  cargo: string | null;
  jornada: string | null;
  temBanco: boolean;
  horaEntrada: string | null;
  diasTrabalhados: number;
  trabalhadoMin: number;
  noturnoMin: number;
  noturnoFictoMin: number;
  previstoMin: number;
  abonadoMin: number;
  saldoMin: number;
  /** Banco de horas antes do mês: Stelanto + acertos + ponto próprio até o dia 1. */
  saldoAnteriorMin: number;
  /** Acertos lançados à mão no /rh/banco-horas com data dentro do mês. */
  acertosMesMin: number;
  /** Saldo geral no fim do mês = anterior + acertos do mês + saldo do mês. */
  saldoGeralMin: number;
  temLancamento: boolean;
  extraMin: number;
  faltaMin: number;
  faltas: number;
  incompletos: number;
  atrasos: number;
  atrasoMin: number;
  atestadoDias: number;
  porCelular: number;
  corrigidas: number;
  ajustes: number;
  outrasCasas: number;
  dias: LinhaDia[];
}

function mesValido(m: string | undefined, hoje: string): string {
  return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : hoje.slice(0, 7);
}
function mesSomar(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function ultimoDia(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
function hmParaMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const csvCampo = (v: string | number) => {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function csvHref(linhas: (string | number)[][]): string {
  const txt = '﻿' + linhas.map((l) => l.map(csvCampo).join(';')).join('\n');
  return `data:text/csv;charset=utf-8,${encodeURIComponent(txt)}`;
}

const ROTULO: Record<Situacao, { txt: string; cls: string }> = {
  ok: { txt: 'ok', cls: 'bg-emerald-50 text-emerald-700' },
  extra: { txt: 'hora extra', cls: 'bg-blue-50 text-blue-700' },
  menos: { txt: 'horas a menos', cls: 'bg-red-50 text-red-600' },
  falta: { txt: 'falta', cls: 'bg-red-100 text-red-700' },
  incompleto: { txt: 'incompleto', cls: 'bg-amber-100 text-amber-800' },
  atestado: { txt: 'atestado', cls: 'bg-violet-100 text-violet-700' },
  folga: { txt: 'folga', cls: 'bg-slate-100 text-slate-500' },
  hoje: { txt: 'hoje (em andamento)', cls: 'bg-slate-100 text-slate-500' },
  fora: { txt: '—', cls: 'text-slate-300' },
};

export default async function RelatorioPontoPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'ponto.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada = await escolherFilial(filiais, sp.filialId);
  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = filialSelecionada;

  const hoje = hojeBr();
  const mes = mesValido(sp.mes, hoje);
  const view = sp.view === 'analitico' ? 'analitico' : 'sintetico';
  const ini = `${mes}-01`;
  const fim = ultimoDia(mes);
  const virada = pontoProprioDesde(filial.id);

  const funcionarios = await db
    .select({
      id: schema.funcionario.id,
      nome: schema.funcionario.nome,
      cargo: schema.funcionario.cargo,
      dataAdmissao: schema.funcionario.dataAdmissao,
      dataDesligamento: schema.funcionario.dataDesligamento,
      ativo: schema.funcionario.ativo,
      horaEntrada: schema.funcionario.pontoHoraEntrada,
    })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.filialId, filial.id))
    .orderBy(asc(schema.funcionario.nome));

  const todosIds = funcionarios.map((f) => f.id);
  const [batidas, ajustes, vigRows, jornadas, casas] = todosIds.length
    ? await Promise.all([
        db
          .select({
            funcionarioId: schema.pontoBatida.funcionarioId,
            filialId: schema.pontoBatida.filialId,
            dia: schema.pontoBatida.diaOperacional,
            quando: schema.pontoBatida.quando,
            tipo: schema.pontoBatida.tipo,
            origem: schema.pontoBatida.origem,
            geoLat: schema.pontoBatida.geoLat,
            geoLng: schema.pontoBatida.geoLng,
            geoDistanciaM: schema.pontoBatida.geoDistanciaM,
          })
          .from(schema.pontoBatida)
          .where(
            and(
              inArray(schema.pontoBatida.funcionarioId, todosIds),
              gte(schema.pontoBatida.diaOperacional, ini),
              lte(schema.pontoBatida.diaOperacional, fim),
              isNull(schema.pontoBatida.excluidaEm),
            ),
          )
          .orderBy(asc(schema.pontoBatida.quando)),
        db
          .select({ funcionarioId: schema.pontoBatidaAjuste.funcionarioId, dia: schema.pontoBatidaAjuste.dia })
          .from(schema.pontoBatidaAjuste)
          .where(
            and(
              inArray(schema.pontoBatidaAjuste.funcionarioId, todosIds),
              gte(schema.pontoBatidaAjuste.dia, ini),
              lte(schema.pontoBatidaAjuste.dia, fim),
            ),
          ),
        db
          .select({
            funcionarioId: schema.funcionarioJornada.funcionarioId,
            jornadaId: schema.funcionarioJornada.jornadaId,
            vigenteDesde: schema.funcionarioJornada.vigenteDesde,
          })
          .from(schema.funcionarioJornada)
          .where(inArray(schema.funcionarioJornada.funcionarioId, todosIds)),
        db
          .select({
            id: schema.rhJornada.id,
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
          .from(schema.rhJornada),
        db.select({ id: schema.filial.id, nome: schema.filial.nome }).from(schema.filial),
      ])
    : [[], [], [], [], []];

  // Quem aparece: ativo, ou que bateu ponto no mês (desligado no meio do mês entra).
  const comBatida = new Set(batidas.map((b) => b.funcionarioId));
  const pessoas = funcionarios.filter((f) => f.ativo || comBatida.has(f.id));
  const ids = pessoas.map((p) => p.id);

  const jornadaPorId = new Map(jornadas.map((j) => [j.id, j]));
  const nomeCasa = new Map(casas.map((c) => [c.id, c.nome]));
  const [atestados, escala] = await Promise.all([atestadosNoPeriodo(ids, ini, fim), diasTrabalhoEscala(ids, ini, fim)]);
  const diaAtestado = diasDeAtestado(atestados, ini, fim);

  const batPorDia = new Map<string, typeof batidas>();
  for (const b of batidas) {
    const k = `${b.funcionarioId}|${b.dia}`;
    const l = batPorDia.get(k) ?? [];
    l.push(b);
    batPorDia.set(k, l);
  }
  const ajustesPorPessoa = new Map<string, number>();
  for (const a of ajustes) ajustesPorPessoa.set(a.funcionarioId, (ajustesPorPessoa.get(a.funcionarioId) ?? 0) + 1);

  // Saldo geral (25/10/2026): o mês sozinho esconde a dívida que veio de antes
  // (ex.: −365 h do Stelanto). Mesma conta do /rh/banco-horas: saldo inicial +
  // acertos + (trabalhado + abonado − previsto) do ponto próprio até o dia 1.
  const antesIni = somarDias(ini, -1);
  const [lancRows, batAntes, atestAntes] = ids.length
    ? await Promise.all([
        db
          .select({
            funcionarioId: schema.bancoHorasLancamento.funcionarioId,
            dia: schema.bancoHorasLancamento.dia,
            minutos: schema.bancoHorasLancamento.minutos,
          })
          .from(schema.bancoHorasLancamento)
          .where(and(inArray(schema.bancoHorasLancamento.funcionarioId, ids), lte(schema.bancoHorasLancamento.dia, fim))),
        ini > virada
          ? db
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
                  gte(schema.pontoBatida.diaOperacional, virada),
                  lte(schema.pontoBatida.diaOperacional, antesIni),
                  isNull(schema.pontoBatida.excluidaEm),
                ),
              )
          : Promise.resolve([]),
        ini > virada ? atestadosNoPeriodo(ids, virada, antesIni) : Promise.resolve([]),
      ])
    : [[], [], []];
  const diaAtestadoAntes = diasDeAtestado(atestAntes, virada, antesIni);
  // funcionario|dia -> minutos trabalhados antes do mês (por casa, depois soma)
  const trabAntes = new Map<string, number>();
  {
    const porCasa = new Map<string, { quando: Date; tipo: 'entrada' | 'saida' }[]>();
    for (const b of batAntes) {
      const k = `${b.funcionarioId}|${b.dia}|${b.filialId}`;
      const l = porCasa.get(k) ?? [];
      l.push({ quando: b.quando, tipo: b.tipo as 'entrada' | 'saida' });
      porCasa.set(k, l);
    }
    for (const [k, l] of porCasa) {
      const [fid, dia] = k.split('|');
      trabAntes.set(`${fid}|${dia}`, (trabAntes.get(`${fid}|${dia}`) ?? 0) + calcularDia(l).totalMin);
    }
  }

  const diasMes: string[] = [];
  for (let d = ini; d <= fim; d = somarDias(d, 1)) diasMes.push(d);

  const resumos: Resumo[] = pessoas.map((f) => {
    const vigencias: VigenciaJornada[] = vigRows
      .filter((v) => v.funcionarioId === f.id)
      .flatMap((v) => {
        const j = jornadaPorId.get(v.jornadaId);
        return j ? [{ ...j, jornadaId: j.id, vigenteDesde: v.vigenteDesde }] : [];
      });
    const jAtual = jornadaNoDia(vigencias, fim < hoje ? fim : hoje);
    const esc = escala.get(f.id);
    let inicio = virada;
    if (f.dataAdmissao && f.dataAdmissao > inicio) inicio = f.dataAdmissao;

    const r: Resumo = {
      id: f.id,
      nome: f.nome,
      cargo: f.cargo,
      jornada: jAtual?.nome ?? null,
      temBanco: jAtual?.tipo === 'fixa',
      horaEntrada: f.horaEntrada,
      diasTrabalhados: 0,
      trabalhadoMin: 0,
      noturnoMin: 0,
      noturnoFictoMin: 0,
      previstoMin: 0,
      abonadoMin: 0,
      saldoMin: 0,
      saldoAnteriorMin: 0,
      acertosMesMin: 0,
      saldoGeralMin: 0,
      temLancamento: false,
      extraMin: 0,
      faltaMin: 0,
      faltas: 0,
      incompletos: 0,
      atrasos: 0,
      atrasoMin: 0,
      atestadoDias: 0,
      porCelular: 0,
      corrigidas: 0,
      ajustes: ajustesPorPessoa.get(f.id) ?? 0,
      outrasCasas: 0,
      dias: [],
    };

    for (const dia of diasMes) {
      const lista = batPorDia.get(`${f.id}|${dia}`) ?? [];
      const foraDoPeriodo =
        dia > hoje || dia < inicio || (!!f.dataDesligamento && dia > f.dataDesligamento);

      // Horas por casa (um par entrada/saída não cruza casas), depois soma.
      const porCasa = new Map<string, { quando: Date; tipo: 'entrada' | 'saida' }[]>();
      for (const b of lista) {
        const l = porCasa.get(b.filialId) ?? [];
        l.push({ quando: b.quando, tipo: b.tipo as 'entrada' | 'saida' });
        porCasa.set(b.filialId, l);
      }
      let trab = 0;
      let notReal = 0;
      let notFicto = 0;
      let incompleto = false;
      for (const l of porCasa.values()) {
        const c = calcularDia(l);
        trab += c.totalMin;
        const n = minutosNoturnos(c.pares);
        notReal += n.reais;
        notFicto += n.fictos;
        if (c.status === 'incompleto' || c.orfas > 0) incompleto = true;
      }

      const j = jornadaNoDia(vigencias, dia);
      const prevJornada = j ? minutosPrevistos(j, dia) : 0;
      const temEscala = !!esc && esc.comLinha > 0;
      const diaDeTrabalho = temEscala ? esc!.trabalho.has(dia) : prevJornada > 0;
      const atest = diaAtestado.get(`${f.id}|${dia}`);
      const abona = !!atest && atest.abona !== false;

      const situacoes: Situacao[] = [];
      let atrasoMin = 0;
      let saldo: number | null = null;
      const prev = foraDoPeriodo || dia === hoje ? 0 : prevJornada;

      if (lista.length > 0) {
        r.diasTrabalhados++;
        r.trabalhadoMin += trab;
        r.noturnoMin += notReal;
        r.noturnoFictoMin += notFicto;
        for (const b of lista) {
          if (b.origem === 'celular') r.porCelular++;
          if (b.origem === 'correcao') r.corrigidas++;
          if (b.filialId !== filial.id) r.outrasCasas++;
        }
        if (incompleto && dia !== hoje) {
          situacoes.push('incompleto');
          r.incompletos++;
        }
        const primeiraEntrada = lista.find((b) => b.tipo === 'entrada');
        if (f.horaEntrada && primeiraEntrada && diaDeTrabalho) {
          const atraso = hmParaMin(horaMinutoBr(primeiraEntrada.quando)) - hmParaMin(f.horaEntrada);
          // Atraso de mais de 6 h é outro turno, não atraso.
          if (atraso > TOLERANCIA_ATRASO_MIN && atraso < 360) {
            atrasoMin = atraso;
            r.atrasos++;
            r.atrasoMin += atraso;
          }
        }
      }

      if (dia === hoje) situacoes.push('hoje');
      else if (foraDoPeriodo && lista.length === 0) situacoes.push('fora');
      else if (!foraDoPeriodo) {
        r.previstoMin += prev;
        let abonado = 0;
        if (abona) {
          situacoes.push('atestado');
          r.atestadoDias++;
          abonado = Math.max(prev - trab, 0);
          r.abonadoMin += abonado;
        } else if (lista.length === 0) {
          if (diaDeTrabalho) {
            situacoes.push('falta');
            r.faltas++;
            r.faltaMin += prev;
          } else situacoes.push('folga');
        }
        if (r.temBanco) {
          saldo = trab + abonado - prev;
          r.saldoMin += saldo;
          if (saldo > 0) {
            r.extraMin += saldo;
            if (lista.length > 0 && saldo > TOLERANCIA_DIA_MIN) situacoes.push('extra');
          }
          if (lista.length > 0 && !abona && saldo < -TOLERANCIA_DIA_MIN) situacoes.push('menos');
        }
        if (lista.length > 0 && situacoes.length === 0) situacoes.push(!diaDeTrabalho && r.temBanco && trab > 0 ? 'extra' : 'ok');
      }
      if (atrasoMin > 0 && situacoes.includes('ok')) situacoes.splice(situacoes.indexOf('ok'), 1);

      r.dias.push({
        dia,
        batidas: lista.map((b) => ({
          hora: horaMinutoBr(b.quando),
          tipo: b.tipo as 'entrada' | 'saida',
          origem: b.origem,
          outraCasa: b.filialId !== filial.id ? nomeCasa.get(b.filialId) ?? 'outra casa' : null,
          geoLat: b.geoLat != null ? Number(b.geoLat) : null,
          geoLng: b.geoLng != null ? Number(b.geoLng) : null,
          geoDistanciaM: b.geoDistanciaM ?? null,
        })),
        trabalhadoMin: trab,
        noturnoMin: notReal,
        noturnoFictoMin: notFicto,
        previstoMin: prev,
        saldoMin: saldo,
        situacoes,
        atrasoMin,
        atestado: atest ? atest.descricao || (atest.abona === false ? 'atestado (sem abonar)' : 'atestado') : null,
      });
    }
    // Saldo anterior e geral (mesma regra do /rh/banco-horas).
    const lancs = lancRows.filter((l) => l.funcionarioId === f.id);
    r.temLancamento = lancs.length > 0;
    for (const l of lancs) {
      if (l.dia < ini) r.saldoAnteriorMin += l.minutos;
      else r.acertosMesMin += l.minutos;
    }
    if (r.temBanco && ini > virada) {
      const primeiraVigencia = vigencias.map((v) => v.vigenteDesde).sort()[0] ?? null;
      let conta = virada;
      if (primeiraVigencia && primeiraVigencia > conta) conta = primeiraVigencia;
      if (f.dataAdmissao && f.dataAdmissao > conta) conta = f.dataAdmissao;
      for (let dia = conta; dia <= antesIni; dia = somarDias(dia, 1)) {
        const t = trabAntes.get(`${f.id}|${dia}`) ?? 0;
        const j = jornadaNoDia(vigencias, dia);
        const prev = j ? minutosPrevistos(j, dia) : 0;
        const atest = diaAtestadoAntes.get(`${f.id}|${dia}`);
        const abonado = atest && atest.abona !== false && prev > 0 ? Math.max(prev - t, 0) : 0;
        r.saldoAnteriorMin += t + abonado - prev;
      }
    }
    r.saldoGeralMin = r.saldoAnteriorMin + r.acertosMesMin + (r.temBanco ? r.saldoMin : 0);
    return r;
  });

  const pessoaSel = sp.pessoa && resumos.some((r) => r.id === sp.pessoa) ? sp.pessoa : null;
  const doAnalitico = pessoaSel ? resumos.filter((r) => r.id === pessoaSel) : resumos;

  const tot = resumos.reduce(
    (a, r) => ({
      trab: a.trab + r.trabalhadoMin,
      faltas: a.faltas + r.faltas,
      incompletos: a.incompletos + r.incompletos,
      atrasos: a.atrasos + r.atrasos,
      atestado: a.atestado + r.atestadoDias,
      celular: a.celular + r.porCelular,
      corrigidas: a.corrigidas + r.ajustes,
    }),
    { trab: 0, faltas: 0, incompletos: 0, atrasos: 0, atestado: 0, celular: 0, corrigidas: 0 },
  );

  const [ano, mm] = mes.split('-').map(Number);
  const nomeMes = `${MESES[mm - 1]} de ${ano}`;
  const url = (p: Partial<SP>) => {
    const q = new URLSearchParams({ filialId: filial.id, mes, view, ...(pessoaSel ? { pessoa: pessoaSel } : {}) });
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined || v === '') q.delete(k);
      else q.set(k, v);
    }
    return `?${q.toString()}`;
  };

  const csvSintetico = csvHref([
    ['Pessoa', 'Cargo', 'Jornada', 'Dias trabalhados', 'Horas trabalhadas', 'Horas previstas', 'Saldo do mês', 'Saldo anterior', 'Acertos do mês', 'Saldo geral', 'Hora extra', 'Noturno 22h–5h (relógio)', 'Noturno (hora reduzida 52min30s)', 'Faltas', 'Horas de falta', 'Incompletos', 'Atrasos', 'Min de atraso', 'Dias de atestado', 'Batidas pelo celular', 'Ajustes à mão (inclusão, alteração, exclusão)'],
    ...resumos.map((r) => [
      r.nome,
      r.cargo ?? '',
      r.jornada ?? '',
      r.diasTrabalhados,
      fmtHoras(r.trabalhadoMin),
      r.temBanco ? fmtHoras(r.previstoMin) : '',
      r.temBanco ? fmtSaldo(r.saldoMin) : '',
      r.temBanco || r.temLancamento ? fmtSaldo(r.saldoAnteriorMin) : '',
      r.temBanco || r.temLancamento ? fmtSaldo(r.acertosMesMin) : '',
      r.temBanco || r.temLancamento ? fmtSaldo(r.saldoGeralMin) : '',
      r.temBanco ? fmtHoras(r.extraMin) : '',
      r.noturnoMin ? fmtHoras(r.noturnoMin) : '',
      r.noturnoFictoMin ? fmtHoras(r.noturnoFictoMin) : '',
      r.faltas,
      r.temBanco ? fmtHoras(r.faltaMin) : '',
      r.incompletos,
      r.atrasos,
      r.atrasoMin,
      r.atestadoDias,
      r.porCelular,
      r.ajustes,
    ]),
  ]);
  const csvAnalitico = csvHref([
    ['Pessoa', 'Dia', 'Semana', 'Batidas', 'Trabalhado', 'Noturno 22h–5h', 'Noturno (hora reduzida)', 'Previsto', 'Saldo', 'Situação', 'Atraso (min)'],
    ...doAnalitico.flatMap((r) =>
      r.dias
        .filter((d) => !d.situacoes.includes('fora'))
        .map((d) => [
          r.nome,
          d.dia.split('-').reverse().join('/'),
          SEMANA[diaDaSemana(d.dia)],
          d.batidas.map((b) => `${b.tipo === 'entrada' ? 'E' : 'S'} ${b.hora}${b.origem === 'celular' ? ' (celular)' : b.origem === 'correcao' ? ' (corrigida)' : ''}${b.outraCasa ? ` [${b.outraCasa}]` : ''}`).join(' · '),
          d.batidas.length ? fmtHoras(d.trabalhadoMin) : '',
          d.noturnoMin ? fmtHoras(d.noturnoMin) : '',
          d.noturnoFictoMin ? fmtHoras(d.noturnoFictoMin) : '',
          d.previstoMin ? fmtHoras(d.previstoMin) : '',
          d.saldoMin === null ? '' : fmtSaldo(d.saldoMin),
          d.situacoes.map((s) => ROTULO[s].txt).join(', ') + (d.atestado ? ` (${d.atestado})` : ''),
          d.atrasoMin || '',
        ]),
    ),
  ]);

  // Dia incompleto/falta → abre /rh/ponto na semana do dia com a correção aberta.
  const ajustarHref = (funcionarioId: string, dia: string) =>
    `/rh/ponto?${new URLSearchParams({ filialId: filial.id, inicio: dia, abrir: funcionarioId }).toString()}`;

  const btn = 'rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50';

  return (
    <main className="min-h-screen bg-slate-50 print:bg-white">
      <div className="print:hidden">
        <AppHeader userEmail={user.email} />
      </div>

      <section className="mx-auto max-w-7xl px-6 py-8 print:px-0 print:py-0">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Relatório do ponto — {nomeMes}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {filial.nome} · {view === 'sintetico' ? 'sintético (por pessoa)' : 'analítico (dia a dia)'}
              {pessoaSel ? ` · ${resumos.find((r) => r.id === pessoaSel)?.nome}` : ''}
              {mes === hoje.slice(0, 7) ? ' · mês em andamento, conta até ontem' : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <a href={`/rh/ponto?filialId=${filial.id}`} className={btn}>Ponto da semana</a>
            <a href={`/rh/banco-horas?filialId=${filial.id}`} className={btn}>Banco de horas</a>
            <a href={view === 'sintetico' ? csvSintetico : csvAnalitico} download={`ponto-${view}-${mes}.csv`} className={btn}>⬇ Planilha (CSV)</a>
            <BotaoImprimir />
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
          {filiais.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {filiais.map((f) => (
                <a
                  key={f.id}
                  href={`?filialId=${f.id}&mes=${mes}&view=${view}`}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    f.id === filial.id ? 'border-blue-500 bg-blue-50 font-medium text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {f.nome}
                </a>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1">
            <a href={url({ mes: mesSomar(mes, -1) })} className={btn}>‹</a>
            <span className="px-2 text-sm font-medium text-slate-700">{nomeMes}</span>
            <a href={url({ mes: mesSomar(mes, 1) })} className={btn}>›</a>
          </div>
          <div className="flex overflow-hidden rounded-md border border-slate-200">
            <a href={url({ view: 'sintetico', pessoa: '' })} className={`px-3 py-1.5 text-sm ${view === 'sintetico' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}>Sintético</a>
            <a href={url({ view: 'analitico' })} className={`px-3 py-1.5 text-sm ${view === 'analitico' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}>Analítico</a>
          </div>
          {view === 'analitico' && pessoaSel && (
            <a href={url({ pessoa: '' })} className="text-sm text-blue-600 hover:underline">ver todos</a>
          )}
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {[
            ['Pessoas', String(resumos.length), 'text-slate-900'],
            ['Horas trabalhadas', fmtHoras(tot.trab), 'text-slate-900'],
            ['Faltas', String(tot.faltas), tot.faltas ? 'text-red-600' : 'text-slate-900'],
            ['Dias incompletos', String(tot.incompletos), tot.incompletos ? 'text-amber-600' : 'text-slate-900'],
            ['Atrasos', String(tot.atrasos), tot.atrasos ? 'text-amber-600' : 'text-slate-900'],
            ['Dias de atestado', String(tot.atestado), 'text-slate-900'],
            ['Ajustes à mão', String(tot.corrigidas), tot.corrigidas ? 'text-orange-600' : 'text-slate-900'],
          ].map(([rot, val, cls]) => (
            <div key={rot} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">{rot}</div>
              <div className={`mt-1 text-xl font-semibold ${cls}`}>{val}</div>
            </div>
          ))}
        </div>

        {resumos.length === 0 && <p className="text-sm text-slate-500">Ninguém cadastrado nesta casa.</p>}

        {view === 'sintetico' && resumos.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">Pessoa</th>
                  <th className="px-2 py-2 text-right">Dias</th>
                  <th className="px-2 py-2 text-right">Trabalhado</th>
                  <th className="px-2 py-2 text-right">Previsto</th>
                  <th className="px-2 py-2 text-right">Saldo</th>
                  <th className="px-2 py-2 text-right" title="Banco de horas antes deste mês: Stelanto + acertos + ponto próprio">Saldo anterior</th>
                  <th className="px-2 py-2 text-right" title="Saldo anterior + acertos do mês + saldo do mês">Saldo geral</th>
                  <th className="px-2 py-2 text-right">Hora extra</th>
                  <th className="px-2 py-2 text-right" title="Horas entre 22:00 e 05:00 (CLT art. 73). Entre parênteses, em hora noturna reduzida de 52min30s — é a que leva os 20%">🌙 Noturno</th>
                  <th className="px-2 py-2 text-right">Faltas</th>
                  <th className="px-2 py-2 text-right">Incompl.</th>
                  <th className="px-2 py-2 text-right">Atrasos</th>
                  <th className="px-2 py-2 text-right">Atestado</th>
                  <th className="px-2 py-2 text-right">📱</th>
                  <th className="px-2 py-2 text-right">✏️ Ajustes</th>
                </tr>
              </thead>
              <tbody>
                {resumos.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <a href={url({ view: 'analitico', pessoa: r.id })} className="font-medium text-blue-700 hover:underline print:text-slate-900">
                        {r.nome}
                      </a>
                      <div className="text-xs text-slate-400">
                        {[r.cargo, r.jornada ?? 'sem jornada', r.horaEntrada ? `entra ${r.horaEntrada}` : null].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">{r.diasTrabalhados}</td>
                    <td className="px-2 py-2 text-right font-medium">{fmtHoras(r.trabalhadoMin)}</td>
                    <td className="px-2 py-2 text-right text-slate-500">{r.temBanco ? fmtHoras(r.previstoMin) : '—'}</td>
                    <td className={`px-2 py-2 text-right font-medium ${!r.temBanco ? 'text-slate-300' : r.saldoMin < 0 ? 'text-red-600' : r.saldoMin > 0 ? 'text-blue-700' : ''}`}>
                      {r.temBanco ? fmtSaldo(r.saldoMin) : '—'}
                    </td>
                    <td className={`px-2 py-2 text-right ${!(r.temBanco || r.temLancamento) ? 'text-slate-300' : r.saldoAnteriorMin < 0 ? 'text-red-600' : r.saldoAnteriorMin > 0 ? 'text-blue-700' : 'text-slate-400'}`}>
                      {r.temBanco || r.temLancamento ? fmtSaldo(r.saldoAnteriorMin) : '—'}
                    </td>
                    <td
                      className={`px-2 py-2 text-right font-semibold ${!(r.temBanco || r.temLancamento) ? 'text-slate-300' : r.saldoGeralMin < 0 ? 'text-red-600' : r.saldoGeralMin > 0 ? 'text-blue-700' : ''}`}
                      title={r.acertosMesMin ? `inclui ${fmtSaldo(r.acertosMesMin)} de acertos do mês` : undefined}
                    >
                      {r.temBanco || r.temLancamento ? fmtSaldo(r.saldoGeralMin) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right text-blue-700">{r.temBanco && r.extraMin ? fmtHoras(r.extraMin) : ''}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right text-indigo-700">
                      {r.noturnoMin ? (
                        <>
                          {fmtHoras(r.noturnoMin)} <span className="text-xs text-indigo-400">({fmtHoras(r.noturnoFictoMin)})</span>
                        </>
                      ) : (
                        ''
                      )}
                    </td>
                    <td className={`px-2 py-2 text-right ${r.faltas ? 'font-semibold text-red-600' : 'text-slate-300'}`}>{r.faltas || '0'}</td>
                    <td className={`px-2 py-2 text-right ${r.incompletos ? 'font-semibold text-amber-700' : 'text-slate-300'}`}>
                      {r.incompletos ? (
                        <a href={url({ view: 'analitico', pessoa: r.id })} title="Ver os dias incompletos e ajustar" className="underline decoration-dotted hover:text-amber-900">
                          {r.incompletos}
                        </a>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className={`px-2 py-2 text-right ${r.atrasos ? 'text-amber-700' : 'text-slate-300'}`}>
                      {r.atrasos ? `${r.atrasos} (${fmtHoras(r.atrasoMin)})` : r.horaEntrada ? '0' : '—'}
                    </td>
                    <td className={`px-2 py-2 text-right ${r.atestadoDias ? 'text-violet-700' : 'text-slate-300'}`}>{r.atestadoDias || '0'}</td>
                    <td className="px-2 py-2 text-right text-slate-500">{r.porCelular || ''}</td>
                    <td className={`px-2 py-2 text-right ${r.ajustes ? 'text-orange-600' : 'text-slate-300'}`}>{r.ajustes || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view === 'analitico' &&
          doAnalitico.map((r) => (
            <div key={r.id} className="mb-6 break-inside-avoid-page rounded-lg border border-slate-200 bg-white print:break-after-page">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div>
                  <span className="font-semibold text-slate-900">{r.nome}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {[r.cargo, r.jornada ?? 'sem jornada', r.horaEntrada ? `entra ${r.horaEntrada}` : null].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="text-xs text-slate-600">
                  {r.diasTrabalhados} dias · {fmtHoras(r.trabalhadoMin)}
                  {r.temBanco ? ` · previsto ${fmtHoras(r.previstoMin)} · saldo ${fmtSaldo(r.saldoMin)}` : ''}
                  {r.temBanco || r.temLancamento ? ` · saldo anterior ${fmtSaldo(r.saldoAnteriorMin)} · saldo geral ${fmtSaldo(r.saldoGeralMin)}` : ''}
                  {r.faltas ? ` · ${r.faltas} falta(s)` : ''}
                  {r.incompletos ? ` · ${r.incompletos} incompleto(s)` : ''}
                  {r.atrasos ? ` · ${r.atrasos} atraso(s)` : ''}
                  {r.noturnoMin ? ` · 🌙 noturno ${fmtHoras(r.noturnoMin)} (${fmtHoras(r.noturnoFictoMin)} reduzida)` : ''}
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-400">
                  <tr>
                    <th className="px-4 py-1.5">Dia</th>
                    <th className="px-2 py-1.5">Batidas</th>
                    <th className="px-2 py-1.5 text-right">Trabalhado</th>
                    <th className="px-2 py-1.5 text-right" title="Horas entre 22:00 e 05:00">🌙 Noturno</th>
                    <th className="px-2 py-1.5 text-right">Previsto</th>
                    <th className="px-2 py-1.5 text-right">Saldo</th>
                    <th className="px-4 py-1.5">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {r.dias
                    .filter((d) => !d.situacoes.includes('fora'))
                    .map((d) => {
                      const sem = diaDaSemana(d.dia);
                      return (
                        <tr key={d.dia} className={`border-t border-slate-50 ${sem === 0 ? 'bg-slate-50/60' : ''}`}>
                          <td className="whitespace-nowrap px-4 py-1.5 text-slate-700">
                            {ddmm(d.dia)} <span className="text-xs text-slate-400">{SEMANA[sem]}</span>
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex flex-wrap gap-1">
                              {d.batidas.map((b, i) => (
                                <span
                                  key={i}
                                  title={`${b.tipo}${b.origem === 'celular' ? ' pelo celular' : b.origem === 'correcao' ? ' corrigida à mão' : ''}${b.outraCasa ? ` em ${b.outraCasa}` : ''}`}
                                  className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                                    b.origem === 'correcao' ? 'bg-orange-50 text-orange-700' : b.tipo === 'entrada' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'
                                  }`}
                                >
                                  {b.tipo === 'entrada' ? '↘' : '↗'} {b.hora}
                                  {b.origem === 'celular' ? (
                                    b.geoLat != null && b.geoLng != null ? (
                                      <a
                                        href={`https://www.google.com/maps?q=${b.geoLat},${b.geoLng}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={`Ver no mapa onde bateu${b.geoDistanciaM != null ? ` (${b.geoDistanciaM} m da casa)` : ''}`}
                                        className="ml-0.5 underline decoration-dotted"
                                      >
                                        📱
                                      </a>
                                    ) : (
                                      ' 📱'
                                    )
                                  ) : b.origem === 'correcao' ? ' ✏️' : ''}
                                  {b.outraCasa ? ` · ${b.outraCasa}` : ''}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right">{d.batidas.length ? fmtHoras(d.trabalhadoMin) : ''}</td>
                          <td className="px-2 py-1.5 text-right text-indigo-700" title={d.noturnoMin ? `${fmtHoras(d.noturnoFictoMin)} em hora reduzida` : undefined}>
                            {d.noturnoMin ? fmtHoras(d.noturnoMin) : ''}
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-400">{d.previstoMin ? fmtHoras(d.previstoMin) : ''}</td>
                          <td className={`px-2 py-1.5 text-right ${d.saldoMin === null || d.saldoMin === 0 ? 'text-slate-300' : d.saldoMin < 0 ? 'text-red-600' : 'text-blue-700'}`}>
                            {d.saldoMin === null || (d.saldoMin === 0 && !d.previstoMin) ? '' : fmtSaldo(d.saldoMin)}
                          </td>
                          <td className="px-4 py-1.5">
                            <div className="flex flex-wrap gap-1">
                              {d.situacoes.map((s) =>
                                s === 'incompleto' || s === 'falta' ? (
                                  <a
                                    key={s}
                                    href={ajustarHref(r.id, d.dia)}
                                    title="Abrir o dia no ponto pra incluir ou corrigir a batida"
                                    className={`rounded px-1.5 py-0.5 text-xs underline decoration-dotted hover:opacity-80 print:no-underline ${ROTULO[s].cls}`}
                                  >
                                    {ROTULO[s].txt} ✏️
                                  </a>
                                ) : (
                                  <span key={s} className={`rounded px-1.5 py-0.5 text-xs ${ROTULO[s].cls}`}>{ROTULO[s].txt}</span>
                                ),
                              )}
                              {d.atrasoMin > 0 && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">atraso {d.atrasoMin} min</span>
                              )}
                              {d.atestado && d.atestado !== 'atestado' && <span className="text-xs text-violet-600">{d.atestado}</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ))}

        <p className="mt-4 text-xs text-slate-400">
          Horas somam o ponto de todas as casas (marcado com o nome da outra casa). Previsto e saldo seguem a jornada,
          a mesma conta do banco de horas; intermitente não tem saldo. Falta = dia de trabalho na escala do mês (ou na
          jornada, se não tem escala) sem nenhuma batida e sem atestado. Atraso = entrada mais de {TOLERANCIA_ATRASO_MIN} min
          depois da hora de entrada cadastrada em Escala do mês (sem hora cadastrada aparece —). ✏️ = batida lançada ou corrigida à mão (a coluna Ajustes conta cada inclusão, alteração e exclusão feita no /rh/ponto); 📱 = batida pelo celular (clique pra ver no mapa onde bateu). 🌙 Noturno = horas
          trabalhadas entre 22:00 e 05:00 (CLT art. 73: adicional de 20%); entre parênteses, a mesma conta em hora noturna
          reduzida (52min30s vale 1 hora), que é a base do adicional.
        </p>
      </section>
    </main>
  );
}
