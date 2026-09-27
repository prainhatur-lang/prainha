// Geração dos identificadores do cartão.

import { randomBytes, randomInt } from 'node:crypto';

/** Sem I, L e O (confundem com 1 e 0 na hora de digitar). */
const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ';

/** Código de uso único, 4 letras. */
export function gerarCodigo(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += LETRAS[randomInt(LETRAS.length)];
  return s;
}

/** O que o cliente digitou → forma canônica (ou null se não pode ser um código). */
export function normalizarCodigo(x: unknown): string | null {
  const s = String(x ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length !== 4) return null;
  for (const c of s) if (!LETRAS.includes(c)) return null;
  return s;
}

/** Número impresso no cartão: 8 dígitos, não começa com 0. */
export function gerarNumero(): string {
  return String(randomInt(10_000_000, 100_000_000));
}

/** Token do link público /cartao/<token>. */
export function gerarToken(): string {
  return randomBytes(18).toString('base64url');
}

/** Segredo do web service da Apple Wallet (mín. 16 chars). */
export function gerarAppleAuth(): string {
  return randomBytes(24).toString('hex');
}

/** Telefone → só dígitos, com DDD, sem o 55. null se não parece celular BR. */
export function normalizarTelefone(x: unknown): string | null {
  let d = String(x ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 && /^[1-9]{2}[6-9]/.test(d)) d = d.slice(0, 2) + '9' + d.slice(2); // celular antigo sem o 9
  if (d.length !== 11 && d.length !== 10) return null;
  return d;
}

export function formatarNumero(n: string): string {
  return n.length === 8 ? `${n.slice(0, 4)} ${n.slice(4)}` : n;
}
