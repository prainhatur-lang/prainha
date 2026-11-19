// Banco de horas: contas puras (sem banco de dados) em cima da jornada
// (`rh_jornada`) e do ponto. O saldo de uma pessoa é:
//
//   saldo que veio do Stelanto na virada (lançamento 'saldo_inicial')
//   + acertos manuais (ajuste, pagamento, folga)
//   + movimento desde a virada = trabalhado no ponto próprio − previsto na jornada
//
// O movimento NÃO é gravado: é refeito toda vez a partir das batidas, então
// corrigir o ponto conserta o banco sozinho. Só jornada 'fixa' tem banco —
// intermitente recebe pelas horas que trabalhou.

export interface JornadaSemana {
  tipo: string;
  minSeg: number;
  minTer: number;
  minQua: number;
  minQui: number;
  minSex: number;
  minSab: number;
  minDom: number;
}

export interface VigenciaJornada extends JornadaSemana {
  jornadaId: string;
  nome: string;
  vigenteDesde: string;
}

/** 0 = domingo … 6 = sábado, pelo calendário (sem fuso). */
export function diaDaSemana(ymd: string): number {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** Previsto do dia de trabalho na escala do mês, pra quem não tem jornada
 *  (30/10/2026): CLT 44 h em 6 dias = 7h20. Folga da escala = 0. */
export const MIN_DIA_ESCALA_MES = 440;

/** Minutos previstos da jornada no dia; intermitente não tem previsto. */
export function minutosPrevistos(j: JornadaSemana, ymd: string): number {
  if (j.tipo !== 'fixa') return 0;
  return [j.minDom, j.minSeg, j.minTer, j.minQua, j.minQui, j.minSex, j.minSab][diaDaSemana(ymd)] ?? 0;
}

export function minutosSemana(j: JornadaSemana): number {
  return j.minSeg + j.minTer + j.minQua + j.minQui + j.minSex + j.minSab + j.minDom;
}

/** Jornada que vale no dia: a de vigência mais recente que já começou. */
export function jornadaNoDia<T extends { vigenteDesde: string }>(vigencias: T[], ymd: string): T | null {
  let achada: T | null = null;
  for (const v of vigencias) {
    if (v.vigenteDesde <= ymd && (!achada || v.vigenteDesde > achada.vigenteDesde)) achada = v;
  }
  return achada;
}

/** Minutos com sinal → '+13:46' / '−379:00' / '00:00'. */
export function fmtSaldo(min: number): string {
  const abs = Math.abs(Math.round(min));
  const txt = `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  if (abs === 0) return txt;
  return `${min < 0 ? '−' : '+'}${txt}`;
}

/** Minutos sem sinal → '7h20'. */
export function fmtHoras(min: number): string {
  const abs = Math.abs(Math.round(min));
  return `${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, '0')}`;
}

/** 'HH:MM' ou 'H' digitado → minutos; null se não der pra ler. */
export function lerHoras(txt: string): number | null {
  const t = txt.trim().replace(',', '.');
  const hm = /^(\d{1,3}):([0-5]\d)$/.exec(t);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  if (/^\d{1,3}(\.\d{1,2})?$/.test(t)) return Math.round(Number(t) * 60);
  return null;
}

/** Folgas da semana por extenso: 'folga ter' / 'folga seg e ter'. */
export function folgasDaJornada(j: JornadaSemana): string {
  if (j.tipo !== 'fixa') return 'por hora trabalhada';
  const nomes = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  const mins = [j.minSeg, j.minTer, j.minQua, j.minQui, j.minSex, j.minSab, j.minDom];
  const folgas = nomes.filter((_, i) => mins[i] === 0);
  if (folgas.length === 0) return 'sem folga fixa';
  return `folga ${folgas.join(' e ')}`;
}

/** Norma do dono (19/11/2026): hora de banco não passa de 4 meses sem compensar. */
export const BANCO_HORAS_PRAZO_MESES = 4;
/** Quantos dias antes de vencer a tela e o relatório diário começam a avisar. */
export const BANCO_HORAS_AVISO_DIAS = 30;

export interface EventoBanco {
  dia: string;
  /** minutos com sinal: + entrou no banco, − saiu (folga, falta, acerto) */
  min: number;
}
export interface PrazoBanco {
  /** minutos positivos que já passaram dos 4 meses */
  vencidoMin: number;
  /** minutos que vencem nos próximos 30 dias */
  aVencerMin: number;
  /** dia da hora mais antiga ainda no banco, e quando ela vence */
  maisAntigoDia: string | null;
  venceEm: string | null;
}

/** 'AAAA-MM-DD' + n meses (dia 31 em mês curto cai no último dia). */
export function somarMesesYmd(ymd: string, n: number): string {
  const [a, m, d] = ymd.split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

/**
 * Idade das horas do banco: o que sai (folga, falta, acerto negativo) abate
 * primeiro a hora mais antiga; banco negativo é quitado pelas horas seguintes.
 * O que sobra positivo tem a data em que entrou e vence 4 meses depois.
 */
export function idadeDoBanco(eventos: EventoBanco[], hoje: string): PrazoBanco {
  const ordem = eventos
    .map((e, i) => ({ ...e, i }))
    .filter((e) => e.min !== 0)
    .sort((x, y) => (x.dia < y.dia ? -1 : x.dia > y.dia ? 1 : x.i - y.i));
  const fila: EventoBanco[] = [];
  let divida = 0;
  for (const e of ordem) {
    if (e.min > 0) {
      const quita = Math.min(divida, e.min);
      divida -= quita;
      if (e.min - quita > 0) fila.push({ dia: e.dia, min: e.min - quita });
    } else {
      let falta = -e.min;
      while (falta > 0 && fila.length > 0) {
        const usa = Math.min(falta, fila[0].min);
        fila[0].min -= usa;
        falta -= usa;
        if (fila[0].min === 0) fila.shift();
      }
      divida += falta;
    }
  }
  const limiteVencido = somarMesesYmd(hoje, -BANCO_HORAS_PRAZO_MESES);
  let vencidoMin = 0;
  let aVencerMin = 0;
  for (const c of fila) {
    const vence = somarMesesYmd(c.dia, BANCO_HORAS_PRAZO_MESES);
    if (c.dia <= limiteVencido) vencidoMin += c.min;
    else if (diasEntre(hoje, vence) <= BANCO_HORAS_AVISO_DIAS) aVencerMin += c.min;
  }
  const maisAntigoDia = fila[0]?.dia ?? null;
  return {
    vencidoMin,
    aVencerMin,
    maisAntigoDia,
    venceEm: maisAntigoDia ? somarMesesYmd(maisAntigoDia, BANCO_HORAS_PRAZO_MESES) : null,
  };
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000);
}
