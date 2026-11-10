// Escala sugerida: a partir do Estudo de equipe, monta os turnos que cobrem a
// necessidade hora a hora de cada dia da semana (atendimento e cozinha).
// É só SUGESTÃO — nada aqui grava na escala do mês.
//
// Regras do cálculo (as mesmas do estudo):
// - Atendimento (salão+bar+caixa): o necessário pela meta de R$/hora-pessoa,
//   com o mínimo de pessoas da casa aberta (1h antes e 1h depois da venda).
// - Cozinha: no serviço, pratos/hora pela meta (mínimo 1); fora do serviço a
//   cozinha está PRODUZINDO — mantém as horas de hoje, nunca corta.
// - Turno de 4h a 8h de trabalho; acima de 6h tem 1h de intervalo no vale.

import { DOW, horaDoSlot, type EstudoEquipe, type Grupo, type LinhaDow } from './estudo-equipe';

export type SetorEscala = 'atend' | 'cozinha';
export const NOME_SETOR: Record<SetorEscala, string> = { atend: 'Atendimento (salão, bar, caixa)', cozinha: 'Cozinha' };
const GRUPOS_SETOR: Record<SetorEscala, Grupo[]> = { atend: ['salao', 'bar', 'caixa'], cozinha: ['cozinha'] };

const TURNO_MIN = 4;
const TURNO_MAX = 8;

export interface TurnoSugerido {
  setor: SetorEscala;
  ini: number; // slot (horas desde 05:00)
  fim: number; // slot exclusivo
  horas: number; // horas pagas (desconta 1h de intervalo acima de 6h)
  qtd: number;
  intervalo: boolean;
}

export interface DiaSugerido {
  dow: number;
  nome: string;
  aberto: boolean;
  turnos: TurnoSugerido[];
  necessidade: Record<SetorEscala, number[]>; // pessoas por slot
  hoje: Record<SetorEscala, number[]>; // pessoas-equivalentes médias por slot
  horasHoje: Record<SetorEscala, number>;
  horasSugeridas: Record<SetorEscala, number>;
  /** Pessoas por slot que a sugestão põe (necessário, limitado a ±30% de hoje). */
  alvo: Record<SetorEscala, number[]>;
  /** Horas em que hoje falta gente (abaixo do necessário). */
  faltaHoje: Record<SetorEscala, number>;
  /** Horas de falta que ainda ficam depois da sugestão (passo de 30%). */
  faltaDepois: Record<SetorEscala, number>;
  /** Horas acima do necessário hoje. */
  sobraHoje: Record<SetorEscala, number>;
  /** Quantas vezes esse dia da semana aparece no mês. */
  vezesNoMes: number;
}

export interface EscalaSugerida {
  dias: DiaSugerido[];
  custoHora: Record<SetorEscala, number>;
  semana: Record<SetorEscala, { horasHoje: number; horasSugeridas: number; faltaHoje: number; sobraHoje: number }>;
  mes: {
    horasHoje: number;
    horasSugeridas: number;
    economia: number; // R$ estimado no mês (positivo = gasta menos)
    faltaCoberta: number; // horas de falta que a sugestão cobre
    faltaRestante: number; // falta que fica pro próximo passo
  };
  quadro: Record<SetorEscala, { horasSemana: number; cltEquivalente: number; horasTurnosCurtos: number; horasSoFds: number }>;
  observacoes: string[];
}

export const horaTxt = (slot: number) => `${String(horaDoSlot(slot)).padStart(2, '0')}:00`;
export const turnoTxt = (t: { ini: number; fim: number }) => `${horaTxt(t.ini)}–${horaTxt(t.fim)}`;

function necessidade(d: LinhaDow): Record<SetorEscala, number[]> {
  const atend = d.slots.map((s) => (s.necAtend > 0 ? Math.max(0, Math.ceil(s.necAtend - 0.3)) : 0));
  const cozinha = d.slots.map((s) => {
    if (s.servico && s.necCoz > 0) return Math.max(Math.ceil(s.necCoz - 0.3), 1);
    // fora do serviço: produção — mantém o que tem hoje
    return Math.round(s.cozinha);
  });
  return { atend, cozinha };
}

/** Passo máximo da sugestão por hora: até 30% a mais ou a menos do que tem hoje. */
export const PASSO_MAX = 0.3;
function alvoGradual(nec: number[], hoje: number[]): number[] {
  return nec.map((n, i) => {
    const h = hoje[i];
    if (h < 0.5) return n; // hoje não tem ninguém: entra o necessário
    if (n >= h) return Math.min(n, Math.ceil(h * (1 + PASSO_MAX)));
    return Math.max(n, Math.round(h * (1 - PASSO_MAX)));
  });
}

/**
 * Cobre a necessidade escolhendo, a cada passo, o turno que mais tapa buraco por
 * hora paga (empate: o mais longo, depois o que começa mais cedo). No turno acima
 * de 6h a hora do intervalo NÃO conta como cobertura: cai na hora com mais folga
 * do miolo do turno; se abrir buraco, outro turno cobre.
 */
function cobrir(setor: SetorEscala, nec: number[]): TurnoSugerido[] {
  type Vaga = { ini: number; trab: number; span: number; pausa: number };
  const cob = new Array(24).fill(0);
  const turnos: Vaga[] = [];
  const falta = (i: number) => nec[i] - cob[i];
  const por = (t: Vaga, sinal: 1 | -1) => {
    for (let i = t.ini; i < t.ini + t.span; i++) if (i !== t.pausa) cob[i] += sinal;
  };
  for (let guarda = 0; guarda < 300; guarda++) {
    if (!cob.some((_, i) => falta(i) > 0)) break;
    let melhor: { ini: number; trab: number; span: number; pausa: number; util: number } | null = null;
    for (let trab = TURNO_MAX; trab >= TURNO_MIN; trab--) {
      const span = trab > 6 ? trab + 1 : trab;
      for (let ini = 0; ini + span <= 24; ini++) {
        // intervalo: fora das 2 primeiras e 2 últimas horas, onde menos falta gente
        let pausa = -1;
        if (span > trab) {
          for (let i = ini + 2; i <= ini + span - 3; i++) if (pausa < 0 || falta(i) < falta(pausa)) pausa = i;
        }
        let util = 0;
        for (let i = ini; i < ini + span; i++) if (i !== pausa && falta(i) > 0) util++;
        if (!util) continue;
        if (!melhor || util * melhor.trab > melhor.util * trab || (util * melhor.trab === melhor.util * trab && util > melhor.util)) {
          melhor = { ini, trab, span, pausa, util };
        }
      }
    }
    if (!melhor) break;
    const m = melhor;
    por(m, 1);
    turnos.push(m);
  }

  // Enxuga: tira ou encurta cada turno enquanto a necessidade continuar coberta.
  for (let passe = 0; passe < 6; passe++) {
    let mudou = false;
    for (let k = turnos.length - 1; k >= 0; k--) {
      const t = turnos[k];
      por(t, -1);
      if (!cob.some((_, i) => falta(i) > 0)) {
        turnos.splice(k, 1);
        mudou = true;
        continue;
      }
      let troca: Vaga | null = null;
      for (let trab = TURNO_MIN; trab < t.trab && !troca; trab++) {
        const span = trab > 6 ? trab + 1 : trab;
        for (let ini = Math.max(0, t.ini - 2); ini + span <= Math.min(24, t.ini + t.span + 2) && !troca; ini++) {
          const pausas = span > trab ? Array.from({ length: span - 4 }, (_, x) => ini + 2 + x) : [-1];
          for (const pausa of pausas) {
            const c: Vaga = { ini, trab, span, pausa };
            por(c, 1);
            const ok = !cob.some((_, i) => falta(i) > 0);
            por(c, -1);
            if (ok) {
              troca = c;
              break;
            }
          }
        }
      }
      if (troca) {
        turnos[k] = troca;
        por(troca, 1);
        mudou = true;
      } else por(t, 1);
    }
    if (!mudou) break;
  }

  const lista: TurnoSugerido[] = [];
  for (const m of turnos) {
    const igual = lista.find((t) => t.ini === m.ini && t.fim === m.ini + m.span);
    if (igual) igual.qtd++;
    else lista.push({ setor, ini: m.ini, fim: m.ini + m.span, horas: m.trab, qtd: 1, intervalo: m.span > m.trab });
  }
  return lista.sort((a, b) => a.ini - b.ini || a.fim - b.fim);
}

export function sugerirTurnos(e: EstudoEquipe): EscalaSugerida {
  const setores: SetorEscala[] = ['atend', 'cozinha'];
  // custo médio por hora de cada setor (o que a casa paga hoje)
  const custoHora = {} as Record<SetorEscala, number>;
  for (const st of setores) {
    const ps = e.pessoas.filter((p) => GRUPOS_SETOR[st].includes(p.grupo));
    const h = ps.reduce((x, p) => x + p.hCasa, 0);
    const c = ps.reduce((x, p) => x + p.custo, 0);
    custoHora[st] = h > 0 ? c / h : 12;
  }

  const dias: DiaSugerido[] = [];
  for (const d of e.dows) {
    const nec = necessidade(d);
    const hoje: Record<SetorEscala, number[]> = {
      atend: d.slots.map((s) => s.atend),
      cozinha: d.slots.map((s) => s.cozinha),
    };
    const aberto = d.dias > 0 && d.slots.some((s) => s.venda > 0);
    const alvo: Record<SetorEscala, number[]> = {
      atend: alvoGradual(nec.atend, hoje.atend),
      // fora do serviço o alvo já é o de hoje (produção)
      cozinha: alvoGradual(nec.cozinha, hoje.cozinha),
    };
    const turnos = aberto ? setores.flatMap((st) => cobrir(st, alvo[st])) : [];
    const z = () => ({ atend: 0, cozinha: 0 });
    const horasHoje = z(), horasSugeridas = z(), faltaHoje = z(), sobraHoje = z(), faltaDepois = z();
    for (const st of setores) {
      horasHoje[st] = hoje[st].reduce((x, v) => x + v, 0);
      horasSugeridas[st] = turnos.filter((t) => t.setor === st).reduce((x, t) => x + t.horas * t.qtd, 0);
      for (let s = 0; s < 24; s++) {
        faltaHoje[st] += Math.max(0, nec[st][s] - hoje[st][s]);
        sobraHoje[st] += Math.max(0, hoje[st][s] - nec[st][s]);
        if (aberto) faltaDepois[st] += Math.max(0, nec[st][s] - alvo[st][s]);
      }
    }
    dias.push({
      dow: d.dow,
      nome: DOW[d.dow],
      aberto,
      turnos,
      necessidade: nec,
      hoje,
      horasHoje,
      horasSugeridas,
      alvo,
      faltaHoje,
      faltaDepois,
      sobraHoje,
      vezesNoMes: d.diasTodos,
    });
  }

  const semana = {} as EscalaSugerida['semana'];
  const quadro = {} as EscalaSugerida['quadro'];
  let mHoje = 0, mSug = 0, econ = 0, faltaCob = 0, faltaRest = 0;
  for (const st of setores) {
    const ab = dias.filter((d) => d.aberto);
    semana[st] = {
      horasHoje: ab.reduce((x, d) => x + d.horasHoje[st], 0),
      horasSugeridas: ab.reduce((x, d) => x + d.horasSugeridas[st], 0),
      faltaHoje: ab.reduce((x, d) => x + d.faltaHoje[st], 0),
      sobraHoje: ab.reduce((x, d) => x + d.sobraHoje[st], 0),
    };
    for (const d of ab) {
      const hh = d.horasHoje[st] * d.vezesNoMes;
      const hs = d.horasSugeridas[st] * d.vezesNoMes;
      mHoje += hh;
      mSug += hs;
      econ += (hh - hs) * custoHora[st];
      faltaCob += (d.faltaHoje[st] - d.faltaDepois[st]) * d.vezesNoMes;
      faltaRest += d.faltaDepois[st] * d.vezesNoMes;
    }
    const ts = ab.flatMap((d) => d.turnos.filter((t) => t.setor === st).map((t) => ({ t, dow: d.dow })));
    const longas = ts.filter((x) => x.t.horas >= 6).reduce((a, x) => a + x.t.horas * x.t.qtd, 0);
    const curtas = ts.filter((x) => x.t.horas < 6).reduce((a, x) => a + x.t.horas * x.t.qtd, 0);
    // turno que só aparece de sexta a domingo (5,6,0) e não em dia de semana
    const chave = (t: TurnoSugerido) => `${t.ini}-${t.fim}`;
    const semanaChaves = new Set(ts.filter((x) => ![5, 6, 0].includes(x.dow)).map((x) => chave(x.t)));
    const soFds = ts.filter((x) => [5, 6, 0].includes(x.dow) && !semanaChaves.has(chave(x.t))).reduce((a, x) => a + x.t.horas * x.t.qtd, 0);
    quadro[st] = { horasSemana: longas + curtas, cltEquivalente: longas / 44, horasTurnosCurtos: curtas, horasSoFds: soFds };
  }

  const observacoes = [
    `Mudança gradual: em cada hora a sugestão anda no máximo ${Math.round(PASSO_MAX * 100)}% a mais ou a menos do que a casa tem hoje. A sobra calculada é teto, não meta de corte; o que faltar fica pro próximo mês, depois de ver o resultado.`,
    'Turno acima de 6h tem 1h de intervalo (CCT); o horário mostrado já inclui essa hora, que não conta como gente atendendo — tire os intervalos na hora de menor venda, um de cada vez.',
    'Na cozinha, as horas fora do serviço continuam iguais às de hoje: é produção (pré-preparo), não sobra.',
    'Necessidade de atendimento = venda da hora ÷ meta de R$/hora-pessoa, com o mínimo de gente da casa aberta; arredonda pra cima só quando passa de 0,3 pessoa.',
    'Economia estimada pelo custo médio da hora de cada setor neste mês; o custo real depende de quem sai e quem fica (CLT tem salário fixo).',
  ];
  return {
    dias,
    custoHora,
    semana,
    mes: { horasHoje: mHoje, horasSugeridas: mSug, economia: econ, faltaCoberta: faltaCob, faltaRestante: faltaRest },
    quadro,
    observacoes,
  };
}

/** Texto curto dos turnos pra IA montar a escala com nomes. */
export function turnosParaIa(s: EscalaSugerida) {
  return {
    custoMedioHora: { atendimento: Math.round(s.custoHora.atend * 100) / 100, cozinha: Math.round(s.custoHora.cozinha * 100) / 100 },
    porDiaDaSemana: s.dias
      .filter((d) => d.aberto)
      .map((d) => ({
        dia: d.nome,
        vezesNoMes: d.vezesNoMes,
        turnos: d.turnos.map((t) => ({
          setor: t.setor === 'atend' ? 'atendimento' : 'cozinha',
          horario: turnoTxt(t),
          pessoas: t.qtd,
          horasTrabalho: t.horas,
          intervalo1h: t.intervalo,
        })),
        horasHoje: { atendimento: Math.round(d.horasHoje.atend), cozinha: Math.round(d.horasHoje.cozinha) },
        horasSugeridas: { atendimento: d.horasSugeridas.atend, cozinha: d.horasSugeridas.cozinha },
        faltaHojeHoras: { atendimento: Math.round(d.faltaHoje.atend), cozinha: Math.round(d.faltaHoje.cozinha) },
        necessidadePorHora: Object.fromEntries(
          d.necessidade.atend
            .map((v, i) => [horaTxt(i), { atend: v, coz: d.necessidade.cozinha[i], atendHoje: Math.round(d.hoje.atend[i] * 10) / 10 }] as const)
            .filter(([, x]) => x.atend || x.coz || x.atendHoje),
        ),
      })),
    mes: {
      horasHoje: Math.round(s.mes.horasHoje),
      horasSugeridas: Math.round(s.mes.horasSugeridas),
      economiaEstimada: Math.round(s.mes.economia),
      faltaCobertaHoras: Math.round(s.mes.faltaCoberta),
      faltaRestanteHoras: Math.round(s.mes.faltaRestante),
    },
    quadro: s.quadro,
  };
}
