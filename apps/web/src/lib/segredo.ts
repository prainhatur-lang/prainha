// Cifra dos segredos que ficam no banco (hoje: credencial de pagamento por
// filial). AES-256-GCM com chave em env — o banco guarda só o texto cifrado.
//
// A chave NUNCA vai pro banco: mora em CREDENCIAL_SECRET (Vercel). Sem ela o
// app se recusa a gravar e a ler — melhor a tela dizer "não configurado" do
// que gravar chave de cartão em texto puro.
//
// Formato guardado: v1.<iv-base64>.<tag-base64>.<cifra-base64>. O prefixo de
// versão existe pra um dia trocar de algoritmo sem perder o que já está lá.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const VERSAO = 'v1';

function chave(): Buffer {
  const s = process.env.CREDENCIAL_SECRET;
  if (!s || s.length < 16) {
    throw new Error('CREDENCIAL_SECRET não configurada (mínimo 16 caracteres)');
  }
  // sha256 aceita qualquer tamanho de segredo e entrega os 32 bytes do AES-256.
  return createHash('sha256').update(s).digest();
}

export function segredoConfigurado(): boolean {
  const s = process.env.CREDENCIAL_SECRET;
  return !!s && s.length >= 16;
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [VERSAO, iv.toString('base64'), c.getAuthTag().toString('base64'), dados.toString('base64')].join('.');
}

export function decifrar(guardado: string): string {
  const [v, iv, tag, dados] = guardado.split('.');
  if (v !== VERSAO || !iv || !tag || !dados) throw new Error('segredo em formato desconhecido');
  const d = createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
}

/** Só o suficiente pra pessoa reconhecer o que está gravado, sem revelar.
 *  Ex: "1001…7289" pra um MerchantId. Segredo curto vira só "••••". */
export function pista(texto: string): string {
  const t = texto.trim();
  if (t.length < 8) return '••••';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}
