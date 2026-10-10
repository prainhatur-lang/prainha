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
