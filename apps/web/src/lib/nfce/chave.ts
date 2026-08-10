// Chave de acesso da NFC-e (44 dígitos) + dígito verificador (módulo 11).
//
// Layout: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)

import { randomInt } from 'node:crypto';

/** DV módulo 11 (pesos 2..9 da direita pra esquerda) sobre os 43 dígitos. */
export function calcularDv(chave43: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

/** Código numérico aleatório de 8 dígitos, diferente do nNF (regra NT2019.001). */
export function gerarCnf(nNF: number): string {
  for (;;) {
    const c = String(randomInt(0, 100000000)).padStart(8, '0');
    if (Number(c) !== nNF && c !== '00000000') return c;
  }
}

export function montarChave(p: {
  cUF: number;
  /** dhEmi já em BRT — usa ano/mês dele. Formato ISO com offset. */
  dhEmi: string;
  cnpj: string;
  serie: number;
  numero: number;
  /** 1 = emissão normal. */
  tpEmis?: number;
  cnf: string;
}): string {
  const aamm = p.dhEmi.slice(2, 4) + p.dhEmi.slice(5, 7);
  const sem = [
    String(p.cUF).padStart(2, '0'),
    aamm,
    p.cnpj.replace(/\D/g, '').padStart(14, '0'),
    '65',
    String(p.serie).padStart(3, '0'),
    String(p.numero).padStart(9, '0'),
    String(p.tpEmis ?? 1),
    p.cnf.padStart(8, '0'),
  ].join('');
  return sem + String(calcularDv(sem));
}

/** Data-hora atual em BRT com offset explícito (padrão SEFAZ). */
export function agoraBrtIso(): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return (
    `${brt.getUTCFullYear()}-${pad(brt.getUTCMonth() + 1)}-${pad(brt.getUTCDate())}` +
    `T${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())}:${pad(brt.getUTCSeconds())}-03:00`
  );
}
