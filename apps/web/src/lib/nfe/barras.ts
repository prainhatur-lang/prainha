// Code 128 (conjunto C — só dígitos, em pares): o código de barras da chave
// de acesso no DANFE. Devolve as larguras alternadas barra/espaço em módulos.

const PADROES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_C = 105;
const STOP = 106;

/** Retângulos (x, largura) das barras pretas, em módulos, e a largura total. */
export function code128C(digitos: string): { barras: Array<{ x: number; w: number }>; largura: number } {
  const d = digitos.replace(/\D/g, '');
  if (!d || d.length % 2 !== 0) return { barras: [], largura: 0 };
  const valores = [START_C];
  for (let i = 0; i < d.length; i += 2) valores.push(Number(d.slice(i, i + 2)));
  let soma = START_C;
  for (let i = 1; i < valores.length; i++) soma += valores[i]! * i;
  valores.push(soma % 103, STOP);

  const barras: Array<{ x: number; w: number }> = [];
  let x = 0;
  for (const v of valores) {
    const p = PADROES[v]!;
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]);
      if (i % 2 === 0) barras.push({ x, w });
      x += w;
    }
  }
  return { barras, largura: x };
}
