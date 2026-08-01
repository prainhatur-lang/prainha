#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  VERIFICADOR DO CONTRATO — vendas-local
//
//  Roda contra um servidor DE PÉ e confere, uma por uma, as promessas
//  escritas em CONTRATO.md. Se alguma quebrou, ele diz qual e por quê.
//
//    node checar-contrato.mjs                      (usa http://localhost:8790)
//    node checar-contrato.mjs http://192.168.10.60:8790
//
//  Sai com código 1 se qualquer promessa falhou — dá pra prender num script
//  de deploy: se não passar, não sobe.
//
//  ⚠️ Este verificador NÃO escreve nada. Não lança pedido, não cria conta,
//     não paga. Pode rodar contra a loja em pleno serviço.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = (process.argv[2] || 'http://localhost:8790').replace(/\/+$/, '');
const AQUI = dirname(fileURLToPath(import.meta.url));
const FONTE = join(AQUI, 'server.mjs');

// ─────────── infraestrutura ───────────

const provas = [];
/** Declara uma promessa do contrato e como comprová-la. */
function promessa(secao, texto, prova) {
  provas.push({ secao, texto, prova });
}

let _cache = new Map();
async function pega(rota) {
  if (_cache.has(rota)) return _cache.get(rota);
  const r = await fetch(BASE + rota, { headers: { 'cache-control': 'no-cache' } });
  const txt = await r.text();
  const v = { status: r.status, headers: r.headers, txt };
  _cache.set(rota, v);
  return v;
}
async function json(rota) {
  const r = await pega(rota);
  try { return JSON.parse(r.txt); } catch { throw new Error('resposta de ' + rota + ' não é JSON'); }
}

let _fonte = null;
function fonte() {
  if (_fonte == null) _fonte = readFileSync(FONTE, 'utf8');
  return _fonte;
}

/** Falha a promessa com uma frase que explique o estrago, não só o sintoma. */
function exigir(cond, porque) {
  if (!cond) throw new Error(porque);
}
/** Um trecho tem que estar na página; senão a funcionalidade sumiu da tela. */
async function naPagina(rota, trecho, porque) {
  const p = await pega(rota);
  exigir(p.status === 200, `${rota} respondeu HTTP ${p.status}`);
  exigir(p.txt.includes(trecho), porque);
}
/** Um trecho NÃO pode estar — serve pra travar comportamento removido. */
async function foraDaPagina(rota, trecho, porque) {
  const p = await pega(rota);
  exigir(p.status === 200, `${rota} respondeu HTTP ${p.status}`);
  exigir(!p.txt.includes(trecho), porque);
}
function noCodigo(trecho, porque) {
  exigir(fonte().includes(trecho), porque);
}

// ─────────── as promessas entram aqui (preenchidas após a auditoria) ───────────
// (marcador: PROMESSAS)

// ─────────── execução ───────────

const cor = process.stdout.isTTY;
const verde = (s) => (cor ? `\x1b[32m${s}\x1b[0m` : s);
const vermelho = (s) => (cor ? `\x1b[31m${s}\x1b[0m` : s);
const cinza = (s) => (cor ? `\x1b[90m${s}\x1b[0m` : s);

const falhas = [];
let secaoAtual = null;

console.log(`\nCONTRATO DO VENDAS-LOCAL — conferindo ${BASE}\n`);

try {
  const v = await json('/api/versao');
  console.log(cinza(`  versão em execução: ${v.versao} · no ar desde ${v.iniciado_em}\n`));
} catch {
  console.error(vermelho(`  Não consegui falar com ${BASE}. O servidor está de pé?\n`));
  process.exit(2);
}

for (const p of provas) {
  if (p.secao !== secaoAtual) {
    secaoAtual = p.secao;
    console.log(`\n${secaoAtual}`);
  }
  try {
    await p.prova();
    console.log(`  ${verde('✓')} ${p.texto}`);
  } catch (e) {
    console.log(`  ${vermelho('✗')} ${p.texto}`);
    console.log(`      ${vermelho(e.message)}`);
    falhas.push({ ...p, erro: e.message });
  }
}

console.log('\n' + '─'.repeat(66));
if (!falhas.length) {
  console.log(verde(`  ${provas.length} promessas conferidas. Nenhuma quebrada.\n`));
  process.exit(0);
}
console.log(vermelho(`  ${falhas.length} de ${provas.length} promessas QUEBRARAM:\n`));
for (const f of falhas) console.log(vermelho(`   · ${f.texto}`) + `\n     ${f.erro}`);
console.log('\n  Isto é regressão: já funcionou e parou. Não suba assim.\n');
process.exit(1);
