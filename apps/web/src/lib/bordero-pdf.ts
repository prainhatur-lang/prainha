// PDF do borderô pro intermediário (lotérica): a relação de quem ele tem que
// pagar — nome, CPF, banco/agência/conta, referência e valor de cada pessoa —
// e, quando o Pix já foi pago pelo sistema, o comprovante do Pix na 1ª página.
//
// Pedido do dono (13/11/2026): "quando for borderô para a lotérica, já envia o
// comprovante e o borderô automaticamente". Um arquivo só, porque o template
// da Meta leva UM documento.
//
// A página do comprovante repete, campo a campo, o desenho de
// `pdfComprovantePix` (pix-comprovante-whatsapp.ts) — regra do dono de
// 28/10/2026: ali só entra o que o Inter respondeu. A relação é do NOSSO
// cadastro e vem em página separada, com título próprio, pra não se confundir
// com dado do banco.
//
// PDF mínimo (Helvetica, WinAnsi), sem biblioteca, com várias páginas.

import type { DadosComprovantePix } from '@/lib/pix-comprovante-whatsapp';
import { dataBrBordero, type PessoaBordero, type RelacaoBordero } from '@/lib/bordero-relacao';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function pdfTexto(s: string): string {
  // WinAnsi ≈ latin1 pra acentos do português; fora disso vira '?'
  // travessão = 0x97 e meia-risca = 0x96 no WinAnsi
  const limpo = s.replace(/—/g, '\x97').replace(/–/g, '\x96').replace(/[^\x20-\x7e\x96\x97\xa0-\xff]/g, '?');
  return limpo.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function quebrar(s: string, max: number): string[] {
  const out: string[] = [];
  let resto = s;
  while (resto.length > max) {
    let i = resto.lastIndexOf(' ', max);
    if (i < max * 0.5) i = max;
    out.push(resto.slice(0, i).trimEnd());
    resto = resto.slice(i).trimStart();
  }
  out.push(resto);
  return out;
}

// Larguras da Helvetica (milésimos do corpo), caracteres 32..126 — pra quebrar
// a linha na largura da coluna e alinhar o valor à direita.
// prettier-ignore
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
// prettier-ignore
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

function largChar(ch: string, negrito: boolean): number {
  const t = negrito ? W_BOLD : W_REG;
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return t[c - 32];
  if (ch === ' ') return 278;
  if (ch === '—') return 1000;
  if (ch === '–') return 556;
  if (ch === '·') return 278;
  if (ch === 'º') return 365;
  if (ch === 'ª') return 370;
  const b = ch.normalize('NFD').charCodeAt(0); // letra acentuada = largura da letra
  if (b >= 32 && b <= 126) return t[b - 32];
  return 556;
}

function larg(s: string, tam: number, negrito: boolean): number {
  let w = 0;
  for (const ch of s) w += largChar(ch, negrito);
  return (w * tam) / 1000;
}

/** Quebra por largura real (pt), cortando palavra maior que a coluna. */
function quebrarLarg(s: string, maxPt: number, tam: number, negrito: boolean): string[] {
  const out: string[] = [];
  let linha = '';
  // Só espaço comum quebra: o "R$ 480,00" (espaço duro do toLocaleString) fica inteiro.
  for (let p of s.split(/[ \t\r\n]+/).filter(Boolean)) {
    while (larg(p, tam, negrito) > maxPt) {
      if (linha) {
        out.push(linha);
        linha = '';
      }
      let n = Math.max(1, p.length - 1);
      while (n > 1 && larg(p.slice(0, n), tam, negrito) > maxPt) n--;
      out.push(p.slice(0, n));
      p = p.slice(n);
    }
    if (!p) continue;
    const tent = linha ? `${linha} ${p}` : p;
    if (larg(tent, tam, negrito) <= maxPt) linha = tent;
    else {
      out.push(linha);
      linha = p;
    }
  }
  if (linha) out.push(linha);
  return out.length > 0 ? out : [''];
}

const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

class Pagina {
  ops: string[] = [];
  txt(x: number, y: number, tam: number, negrito: boolean, s: string, cinza = 0) {
    const cor = cinza > 0 ? `${cinza} g ` : '';
    const volta = cinza > 0 ? ' 0 g' : '';
    this.ops.push(`${cor}BT /${negrito ? 'F2' : 'F1'} ${tam} Tf ${n2(x)} ${n2(y)} Td (${pdfTexto(s)}) Tj ET${volta}`);
  }
  /** Texto terminando em `xDir`. */
  txtDir(xDir: number, y: number, tam: number, negrito: boolean, s: string) {
    this.txt(xDir - larg(s, tam, negrito), y, tam, negrito, s);
  }
  linha(x1: number, y: number, x2: number, cinza: number, esp = 1) {
    this.ops.push(`${esp} w ${cinza} G ${n2(x1)} ${n2(y)} m ${n2(x2)} ${n2(y)} l S 1 w`);
  }
  caixa(x: number, y: number, w: number, h: number, cinza: number) {
    this.ops.push(`${cinza} g ${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re f 0 g`);
  }
}

// ── Página do comprovante (mesmo desenho de pdfComprovantePix) ─────────────

function paginaComprovante(d: DadosComprovantePix): Pagina {
  const pg = new Pagina();
  let y = 790;
  pg.txt(50, y, 17, true, 'Comprovante de Pix — dados do Banco Inter');
  y -= 20;
  pg.txt(50, y, 9, false, 'Cada campo abaixo veio da consulta do Pix na API do Banco Inter. O que o banco não informa não aparece.');
  y -= 34;
  pg.txt(50, y, 26, true, brl(d.valor));
  y -= 24;
  if (d.endToEnd) {
    pg.caixa(50, y - 34, 495, 46, 0.95);
    pg.txt(60, y - 2, 9, true, 'ID da transação (E2E)');
    pg.txt(60, y - 20, 13, true, d.endToEnd);
    y -= 44;
    pg.txt(50, y, 9, false, 'O E2E pode ser conferido no extrato de quem recebeu.');
    y -= 14;
  }
  pg.linha(50, y, 545, 0.8);
  y -= 24;
  for (const [k, v] of d.campos) {
    pg.txt(50, y, 10, true, k);
    for (const l of quebrar(v, 55)) {
      pg.txt(210, y, 10, false, l);
      y -= 15;
    }
    y -= 7;
  }
  y -= 8;
  pg.linha(50, y, 545, 0.8);
  y -= 16;
  pg.txt(50, y, 8, false, `Pago pela conta Inter da ${d.casa}. Gerado pelo sistema do Prainha com a resposta do Inter.`);
  return pg;
}

// ── Páginas da relação ─────────────────────────────────────────────────────

const X0 = 40;
const X1 = 555;
const COL = { pessoa: 40, cpf: 192, banco: 266, ref: 416 } as const;
const LARG = { pessoa: 146, cpf: 70, banco: 144, ref: 78 } as const;
const ENTRE = 10.5; // entrelinha das células
const PISO = 62; // margem de baixo (o rodapé fica em 30)

function linhasBanco(p: PessoaBordero): string[] {
  const tem = !!(p.bancoConta || p.chavePix);
  if (!tem) return ['sem conta cadastrada'];
  const out: string[] = [];
  if (p.bancoNome) out.push(p.bancoNome);
  const agConta = [p.bancoAgencia ? `ag ${p.bancoAgencia}` : '', p.bancoConta ? `conta ${p.bancoConta}` : '']
    .filter(Boolean)
    .join(' · ');
  if (agConta) out.push(agConta);
  if (p.chavePix) out.push(`Pix: ${p.chavePix}`);
  if (p.contaDeOutraCasa) out.push(`(conta do cadastro: ${p.contaDeOutraCasa})`);
  return out;
}

const maiuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const pessoasTxt = (n: number) => `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;

function cabecalhoTabela(pg: Pagina, y: number): number {
  pg.txt(COL.pessoa, y, 7.5, true, 'PESSOA', 0.35);
  pg.txt(COL.cpf, y, 7.5, true, 'CPF', 0.35);
  pg.txt(COL.banco, y, 7.5, true, 'BANCO / AG / CONTA', 0.35);
  pg.txt(COL.ref, y, 7.5, true, 'REFERÊNCIA', 0.35);
  pg.txt(X1 - larg('VALOR', 7.5, true), y, 7.5, true, 'VALOR', 0.35);
  pg.linha(X0, y - 5, X1, 0.55, 1.2);
  return y - 19;
}

function paginasRelacao(r: RelacaoBordero, comp: DadosComprovantePix | null): Pagina[] {
  const pags: Pagina[] = [];
  let pg = new Pagina();
  pags.push(pg);

  let y = 800;
  pg.txt(X0, y, 16, true, 'Borderô de pagamento');
  y -= 19;
  for (const l of quebrarLarg(maiuscula(r.titulo), X1 - X0, 11.5, true)) {
    pg.txt(X0, y, 11.5, true, l);
    y -= 14;
  }
  const sub = `${r.casa} · intermediário: ${r.intermediario.nome}${
    r.intermediario.contatoNome ? ` (aos cuidados de ${r.intermediario.contatoNome})` : ''
  }`;
  for (const l of quebrarLarg(sub, X1 - X0, 9.5, false)) {
    pg.txt(X0, y, 9.5, false, l, 0.3);
    y -= 12;
  }
  y -= 4;

  // Quadro: total, nº de pessoas e situação do Pix
  const situacao: string[] = [];
  if (comp) {
    situacao.push(`Pix de ${brl(comp.valor)} pago em ${comp.dataHora ?? comp.dataCurta}`);
    if (comp.endToEnd) situacao.push(`E2E ${comp.endToEnd}`);
    situacao.push('Comprovante na 1ª página deste arquivo.');
  } else if (r.pagoEm) {
    situacao.push(`Pago ao intermediário em ${dataBrBordero(r.pagoEm)}.`);
  } else {
    situacao.push('Ainda não pago ao intermediário.');
    if (r.vencimento) situacao.push(`Vence em ${dataBrBordero(r.vencimento)}.`);
  }
  const linhasSit = situacao.flatMap((s) => quebrarLarg(s, 232, 8.5, false));
  const altQuadro = Math.max(46, 20 + linhasSit.length * 11);
  pg.caixa(X0, y - altQuadro, X1 - X0, altQuadro, 0.95);
  pg.txt(X0 + 10, y - 15, 8.5, false, 'Total a depositar', 0.3);
  pg.txt(X0 + 10, y - 35, 17, true, brl(r.soma));
  pg.txt(X0 + 178, y - 15, 8.5, false, 'Pessoas', 0.3);
  pg.txt(X0 + 178, y - 35, 17, true, String(r.pessoas.length));
  pg.txt(X0 + 272, y - 15, 8.5, false, 'Pix ao intermediário', 0.3);
  linhasSit.forEach((l, i) => pg.txt(X0 + 272, y - 27 - i * 11, 8.5, false, l));
  y -= altQuadro + 20;

  y = cabecalhoTabela(pg, y);

  const novaPagina = () => {
    pg = new Pagina();
    pags.push(pg);
    let yy = 800;
    pg.txt(X0, yy, 10.5, true, `Borderô de pagamento — ${r.titulo} (continuação)`);
    yy -= 24;
    return cabecalhoTabela(pg, yy);
  };

  for (const p of r.pessoas) {
    const lNome = quebrarLarg(p.nome, LARG.pessoa, 9, true);
    const lCpf = quebrarLarg(p.documento ?? 'sem CPF', LARG.cpf, 8.5, false);
    const lBanco = linhasBanco(p).flatMap((l) => quebrarLarg(l, LARG.banco, 8.5, false));
    const lRef =
      p.itens.length === 1
        ? quebrarLarg(p.itens[0].rotulo, LARG.ref, 8, false)
        : p.itens.flatMap((i) => quebrarLarg(`${i.rotulo} ${brl(i.valor)}`, LARG.ref, 8, false));
    const n = Math.max(lNome.length, lCpf.length, lBanco.length, lRef.length);
    const altura = n * ENTRE + 7;
    if (y - (n - 1) * ENTRE < PISO) y = novaPagina();
    lNome.forEach((l, i) => pg.txt(COL.pessoa, y - i * ENTRE, 9, true, l));
    lCpf.forEach((l, i) => pg.txt(COL.cpf, y - i * ENTRE, 8.5, false, l));
    lBanco.forEach((l, i) => pg.txt(COL.banco, y - i * ENTRE, 8.5, false, l));
    lRef.forEach((l, i) => pg.txt(COL.ref, y - i * ENTRE, 8, false, l, 0.25));
    pg.txtDir(X1, y, 9.5, true, brl(p.total));
    y -= altura;
    pg.linha(X0, y + 11, X1, 0.86, 0.6);
  }

  // Total + recado. Precisa de ~95pt; senão vai pra outra página.
  if (y < PISO + 95) y = novaPagina();
  pg.linha(X0, y + 11, X1, 0.35, 1.4);
  y -= 4;
  pg.txt(X0, y, 10.5, true, `TOTAL (${pessoasTxt(r.pessoas.length)})`);
  pg.txtDir(X1, y, 11.5, true, brl(r.soma));
  y -= 22;

  const avisos: string[] = [];
  if (!r.confere) {
    avisos.push(
      `Atenção: a soma das pessoas (${brl(r.soma)}) é diferente do valor do borderô (${brl(r.valor)}). Confira antes de depositar.`,
    );
  }
  if (comp && Math.abs(comp.valor - r.soma) >= 0.005) {
    avisos.push(`Obs.: o Pix foi de ${brl(comp.valor)} e esta relação soma ${brl(r.soma)}.`);
  }
  for (const a of avisos) {
    for (const l of quebrarLarg(a, X1 - X0, 9, true)) {
      pg.txt(X0, y, 9, true, l);
      y -= 12;
    }
    y -= 3;
  }
  const recado =
    'Favor depositar o valor de cada pessoa na conta indicada e devolver os comprovantes dos depósitos para a baixa no sistema.';
  for (const l of quebrarLarg(recado, X1 - X0, 9.5, false)) {
    pg.txt(X0, y, 9.5, false, l);
    y -= 12.5;
  }
  return pags;
}

// ── Montagem do arquivo ────────────────────────────────────────────────────

export type EntradaPdfBordero = {
  /** Comprovante do Pix (resposta do Inter). null = borderô sozinho. */
  comprovante: DadosComprovantePix | null;
  relacoes: RelacaoBordero[];
  /** "13/11/2026 14:02" (BRT) — quando a relação foi tirada. */
  geradoEm: string;
};

export function pdfBordero(e: EntradaPdfBordero): Buffer {
  const pags: Pagina[] = [];
  if (e.comprovante) pags.push(paginaComprovante(e.comprovante));
  const inicioRel = pags.length;
  const donoDaPagina: Array<RelacaoBordero | null> = pags.map(() => null);
  for (const r of e.relacoes) {
    const ps = paginasRelacao(r, e.comprovante);
    for (const p of ps) {
      pags.push(p);
      donoDaPagina.push(r);
    }
  }
  const total = pags.length;
  pags.forEach((pg, i) => {
    const r = donoDaPagina[i];
    const rodape = r
      ? `Relação tirada do sistema do Prainha em ${e.geradoEm} · borderô ${r.borderoId.slice(0, 8)} · página ${i + 1} de ${total}`
      : `Página ${i + 1} de ${total} · o borderô (relação de quem recebe, com conta e valor) ${
          total - inicioRel > 1 ? 'está nas páginas seguintes' : 'está na página seguinte'
        }`;
    pg.txt(X0, 30, 7.5, false, rodape, 0.45);
  });

  // 1 catálogo, 2 páginas, 3 F1, 4 F2, depois (página, conteúdo) de cada uma.
  const kids = pags.map((_, i) => `${5 + 2 * i} 0 R`).join(' ');
  const objs: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from(`<< /Type /Pages /Kids [${kids}] /Count ${total} >>`),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
  ];
  pags.forEach((pg, i) => {
    const conteudo = Buffer.from(pg.ops.join('\n'), 'latin1');
    objs.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`,
      ),
    );
    objs.push(Buffer.concat([Buffer.from(`<< /Length ${conteudo.length} >>\nstream\n`), conteudo, Buffer.from('\nendstream')]));
  });

  const partes: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let pos = partes[0].length;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    partes.push(b);
    pos += b.length;
  });
  const xref =
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  partes.push(Buffer.from(xref));
  return Buffer.concat(partes);
}

/** "comprovante-e-bordero-11-11-2026.pdf" · "bordero-11-11-2026.pdf" (sem comprovante). */
export function nomeArquivoBordero(e: { comprovante: DadosComprovantePix | null; relacoes: RelacaoBordero[] }): string {
  if (e.comprovante) {
    const data = e.comprovante.dataCurta.replace(/\//g, '-') || 'pix';
    return `comprovante-e-bordero-${data}.pdf`;
  }
  const data = (e.relacoes[0]?.criadoEm ?? '').replace(/\//g, '-') || 'prainha';
  return `bordero-${data}.pdf`;
}

/** Agora em Brasília, "dd/mm/aaaa hh:mm" — carimbo do rodapé. */
export function agoraBrBordero(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
