// Meses 'YYYY-MM' do Histórico de faturamento (VGV). Arquivo puro — sem banco
// nem Next — porque os componentes do navegador também usam (o motor, em
// faturamento-historico.ts, puxa o banco e não pode ir pro navegador).

export const MESES_CURTOS = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

export function chaveMes(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

export function partesMes(chave: string): { ano: number; mes: number } {
  return { ano: Number(chave.slice(0, 4)), mes: Number(chave.slice(5, 7)) };
}

/** Soma n meses (n pode ser negativo). */
export function somaMeses(chave: string, n: number): string {
  const { ano, mes } = partesMes(chave);
  const t = ano * 12 + (mes - 1) + n;
  return chaveMes(Math.floor(t / 12), (((t % 12) + 12) % 12) + 1);
}

/** Meses de `de` até `ate`, os dois dentro. Vazio se de > ate. */
export function intervaloMeses(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let m = de; m <= ate; m = somaMeses(m, 1)) out.push(m);
  return out;
}

/** 'set/2026' */
export function rotuloMes(chave: string): string {
  const { ano, mes } = partesMes(chave);
  return `${MESES_CURTOS[mes - 1] ?? '?'}/${ano}`;
}

export function mesValido(chave: unknown): chave is string {
  if (typeof chave !== 'string' || !/^\d{4}-\d{2}$/.test(chave)) return false;
  const { ano, mes } = partesMes(chave);
  return ano >= 2000 && ano <= 2100 && mes >= 1 && mes <= 12;
}

/** 'out/2025 a set/2026' · 'jan a set/2026' (mesmo ano) · 'set/2026' (um mês só). */
export function rotuloPeriodo(meses: string[]): string {
  const de = meses[0];
  const ate = meses[meses.length - 1];
  if (!de || !ate) return '';
  if (de === ate) return rotuloMes(de);
  const a = partesMes(de);
  const b = partesMes(ate);
  if (a.ano === b.ano) return `${MESES_CURTOS[a.mes - 1] ?? '?'} a ${rotuloMes(ate)}`;
  return `${rotuloMes(de)} a ${rotuloMes(ate)}`;
}

/** Junta meses seguidos em faixas: abr, mai, jul → [[abr, mai], [jul]]. */
export function faixasDeMeses(meses: string[]): string[][] {
  const out: string[][] = [];
  for (const m of [...meses].sort()) {
    const ultima = out[out.length - 1];
    if (ultima && somaMeses(ultima[ultima.length - 1]!, 1) === m) ultima.push(m);
    else out.push([m]);
  }
  return out;
}
