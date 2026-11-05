// Intermitente sem adicional noturno (decisão do dono 05/11/2026: "eu vou
// calcular pelo nosso sistema e quero que tire o adicional noturno do
// intermitente"). A nossa folha mensal já não paga noturno
// (PAGAR_NOTURNO_NA_FOLHA_MENSAL = false), mas a tela da folha do contador e o
// contracheque impresso mostravam as rubricas que o contador lançou
// (26 adicional noturno, 241 hora noturna reduzida, 854 reflexo no DSR).
// Aqui o intermitente sai sem essas rubricas: proventos e líquido descontam o
// valor retirado. O que está gravado em folha_contador não muda, e a tela
// "Nossa folha × contador" continua mostrando o contador como veio.

interface RubricaFolhaContador {
  codigo: string;
  descricao: string;
  valor: number;
  tipo: 'P' | 'D';
}

const CODIGOS_NOTURNO = new Set(['25', '26', '219', '241', '250', '854']);

export function ehRubricaNoturna(r: { codigo: string; descricao: string }): boolean {
  return CODIGOS_NOTURNO.has(String(r.codigo).trim()) || /NOTURN/i.test(r.descricao);
}

export function ehIntermitente(vinculo: string | null | undefined): boolean {
  return /intermitente/i.test(vinculo ?? '');
}

const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/** Linha da folha do contador sem o noturno, se for intermitente. */
export function semNoturnoIntermitente<
  T extends { vinculo: string | null; rubricas: RubricaFolhaContador[] | null; proventos: string | null; liquido: string | null },
>(l: T): T & { noturnoRetirado: number } {
  if (!ehIntermitente(l.vinculo)) return { ...l, noturnoRetirado: 0 };
  const rub = l.rubricas ?? [];
  const tirar = rub.filter((r) => r.tipo === 'P' && ehRubricaNoturna(r));
  if (tirar.length === 0) return { ...l, noturnoRetirado: 0 };
  const valor = Math.round(tirar.reduce((s, r) => s + n(r.valor), 0) * 100) / 100;
  return {
    ...l,
    rubricas: rub.filter((r) => !tirar.includes(r)),
    proventos: (n(l.proventos) - valor).toFixed(2),
    liquido: (n(l.liquido) - valor).toFixed(2),
    noturnoRetirado: valor,
  };
}
