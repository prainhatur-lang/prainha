// Telefone com país (dono, 14/10/2026): vem +55 do Brasil de saída, com DDD e
// a máscara (79) 99999-9999; cliente de fora troca o país e o número segue a
// numeração de lá (libphonenumber-js, a mesma base do Google).
//
// Como grava (igual o site já grava): Brasil = 55 + DDD + número, só dígitos;
// fora do Brasil = "+" + DDI + número. O "+" é o aviso pra quem manda
// WhatsApp NÃO pôr 55 na frente — número americano tem 11 dígitos, do mesmo
// tamanho de um celular daqui (+1 305 555 1234 virava 55 13055551234).
import { AsYouType, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export type PaisTel = CountryCode;

/** Brasil primeiro; depois quem mais aparece em Aracaju. */
export const PAISES_TEL: { cc: CountryCode; nome: string }[] = [
  { cc: 'BR', nome: 'Brasil' },
  { cc: 'AR', nome: 'Argentina' },
  { cc: 'US', nome: 'Estados Unidos / Canadá' },
  { cc: 'PT', nome: 'Portugal' },
  { cc: 'UY', nome: 'Uruguai' },
  { cc: 'PY', nome: 'Paraguai' },
  { cc: 'CL', nome: 'Chile' },
  { cc: 'BO', nome: 'Bolívia' },
  { cc: 'PE', nome: 'Peru' },
  { cc: 'CO', nome: 'Colômbia' },
  { cc: 'VE', nome: 'Venezuela' },
  { cc: 'MX', nome: 'México' },
  { cc: 'ES', nome: 'Espanha' },
  { cc: 'IT', nome: 'Itália' },
  { cc: 'FR', nome: 'França' },
  { cc: 'DE', nome: 'Alemanha' },
  { cc: 'GB', nome: 'Reino Unido' },
  { cc: 'IE', nome: 'Irlanda' },
  { cc: 'NL', nome: 'Holanda' },
  { cc: 'BE', nome: 'Bélgica' },
  { cc: 'CH', nome: 'Suíça' },
  { cc: 'AT', nome: 'Áustria' },
  { cc: 'SE', nome: 'Suécia' },
  { cc: 'NO', nome: 'Noruega' },
  { cc: 'DK', nome: 'Dinamarca' },
  { cc: 'PL', nome: 'Polônia' },
  { cc: 'IL', nome: 'Israel' },
  { cc: 'AO', nome: 'Angola' },
  { cc: 'CV', nome: 'Cabo Verde' },
  { cc: 'MZ', nome: 'Moçambique' },
  { cc: 'JP', nome: 'Japão' },
  { cc: 'CN', nome: 'China' },
  { cc: 'AU', nome: 'Austrália' },
];

export function bandeira(cc: string): string {
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function ddiDoPais(cc: CountryCode): string {
  return getCountryCallingCode(cc);
}

/** Máscara do Brasil, aos poucos: (79) 99999-9999 ou (79) 9999-9999. Tira o 55 colado na frente. */
export function mascaraBr(texto: string): string {
  let d = texto.replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const n = d.slice(2);
  if (n.length <= 4) return `(${ddd}) ${n}`;
  if (d.length <= 10) return `(${ddd}) ${n.slice(0, 4)}-${n.slice(4)}`;
  return `(${ddd}) ${n.slice(0, 5)}-${n.slice(5)}`;
}

/**
 * Formata enquanto digita. `anterior` = o texto antes da tecla: apagar um
 * parêntese/traço não muda os dígitos e a máscara o poria de volta — aí apaga
 * o último dígito, que é o que a pessoa quis. No Brasil, texto com ponto é CPF
 * (o campo da Nova reserva também busca por CPF) e fica como foi digitado.
 */
export function formatarTelDigitando(cc: CountryCode, texto: string, anterior = ''): string {
  let t = texto;
  const dig = (s: string) => s.replace(/\D/g, '');
  if (t.length < anterior.length && dig(t) === dig(anterior) && dig(t)) {
    const d = dig(t).slice(0, -1);
    t = t.trim().startsWith('+') ? `+${d}` : d;
  }
  if (cc === 'BR' && !t.trim().startsWith('+')) {
    if (t.includes('.')) return t;
    return mascaraBr(t);
  }
  return new AsYouType(cc).input(t);
}

/** O que vai pro banco. Ver o cabeçalho: BR = só dígitos com 55; fora = "+DDI…". */
export function telefoneParaGravar(cc: CountryCode, texto: string): string | null {
  const t = texto.trim();
  const d = t.replace(/\D/g, '');
  if (!d) return null;
  if (cc === 'BR' && !t.startsWith('+')) {
    if (t.includes('.')) return d; // CPF que não achou ninguém — fica como veio
    if (d.length === 10 || d.length === 11) return `55${d}`;
    return d; // já com 55, ou sem DDD — como veio
  }
  const p = parsePhoneNumberFromString(t, cc);
  if (p && p.isPossible()) return p.countryCallingCode === '55' ? p.number.slice(1) : p.number;
  return `+${getCountryCallingCode(cc)}${d}`;
}

/** Número gravado → país + texto pro campo (o cadastro achado pelo CPF pode ser de fora). */
export function separarTelefone(gravado: string): { cc: CountryCode; texto: string } {
  const t = gravado.trim();
  if (t.startsWith('+') && !t.startsWith('+55')) {
    const p = parsePhoneNumberFromString(t);
    if (p?.country) return { cc: p.country, texto: p.formatNational() };
  }
  return { cc: 'BR', texto: mascaraBr(t) };
}

/** Dígitos pro wa.me / Meta: o "+" diz que o DDI já está ali; sem ele, 10–11 dígitos são do Brasil. */
export function telefoneComDdi(gravado: string): string {
  const d = gravado.replace(/\D/g, '');
  if (gravado.trim().startsWith('+')) return d;
  return d.length <= 11 ? `55${d}` : d;
}
