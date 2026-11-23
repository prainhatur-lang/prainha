/**
 * Leitura do código de uma conta de consumo (energia, água, gás, telefone…)
 * ou de um boleto que não chega pelo DDA — tela /financeiro/pagar-conta
 * (dono 23/11/2026). Puro: roda no navegador e no servidor.
 *
 * Aceita:
 *  - linha digitável de boleto bancário (47 dígitos)
 *  - linha digitável de convênio/arrecadação (48 dígitos, começa com 8)
 *  - código de barras cru (44 dígitos, lido do ITF da conta)
 *  - Pix copia-e-cola (BR Code "000201…", lido do QR da conta)
 */

export type CodigoBoleto = {
  tipo: 'BOLETO';
  /** bancário (boleto de banco) ou convênio (concessionária/tributo) */
  especie: 'BANCARIO' | 'CONVENIO';
  codigoBarras: string; // 44 dígitos
  /** como o usuário vai conferir (linha digitável se veio digitada) */
  codigo: string;
  valor: number | null;
  vencimento: string | null; // YYYY-MM-DD (só bancário)
  segmento: string | null; // convênio: energia/gás, saneamento…
};

export type CodigoPix = {
  tipo: 'PIX';
  codigo: string; // o copia-e-cola inteiro
  valor: number | null;
  favorecido: string | null;
  cidade: string | null;
  chave: string | null;
  /** Pix dinâmico (URL de cobrança) — o valor pode vir só do banco */
  dinamico: boolean;
  infoAdicional: string | null;
};

export type CodigoLido = CodigoBoleto | CodigoPix;

export type ResultadoLeitura = { ok: true; dado: CodigoLido } | { ok: false; erro: string };

const SEGMENTOS: Record<string, string> = {
  '1': 'Prefeitura',
  '2': 'Saneamento (água/esgoto)',
  '3': 'Energia elétrica e gás',
  '4': 'Telecomunicações',
  '5': 'Órgão do governo',
  '6': 'Carnê / empresa',
  '7': 'Multa de trânsito',
  '9': 'Uso exclusivo do banco',
};

function mod10(num: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    let p = Number(num[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

/** Módulo 11 do convênio (FEBRABAN): resto 0/1 → 0, resto 10 → 1. */
function mod11Convenio(num: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    soma += Number(num[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  if (resto === 0 || resto === 1) return 0;
  if (resto === 10) return 1;
  return 11 - resto;
}

/** Módulo 11 do código de barras bancário: 0, 10 e 11 viram 1. */
function mod11Bancario(num: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    soma += Number(num[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10); // data de calendário pura (UTC), sem fuso
}

/** Fator de vencimento → data. Reinicia em 22/02/2025 (fator 1000). */
function vencimentoDoFator(fator: number): string | null {
  if (!fator) return null;
  const dia = 86_400_000;
  const antigo = Date.UTC(1997, 9, 7) + fator * dia;
  const corte = Date.UTC(2025, 1, 22);
  if (antigo < corte - 365 * dia) {
    return ymdUtc(new Date(corte + (fator - 1000) * dia));
  }
  return ymdUtc(new Date(antigo));
}

function lerBarras44(barras: string, codigo: string): ResultadoLeitura {
  if (barras[0] === '8') {
    const ident = barras[2];
    const corpo = barras.slice(0, 3) + barras.slice(4);
    const dv = ident === '6' || ident === '8' ? mod10(corpo) : mod11Convenio(corpo);
    if (Number(barras[3]) !== dv) return { ok: false, erro: 'Código de barras com dígito verificador errado — confira os números.' };
    const temValor = ident === '6' || ident === '7';
    const v = Number(barras.slice(4, 15)) / 100;
    return {
      ok: true,
      dado: {
        tipo: 'BOLETO',
        especie: 'CONVENIO',
        codigoBarras: barras,
        codigo,
        valor: temValor && v > 0 ? v : null,
        vencimento: null,
        segmento: SEGMENTOS[barras[1]!] ?? null,
      },
    };
  }
  const dv = mod11Bancario(barras.slice(0, 4) + barras.slice(5));
  if (Number(barras[4]) !== dv) return { ok: false, erro: 'Código de barras com dígito verificador errado — confira os números.' };
  const v = Number(barras.slice(9, 19)) / 100;
  return {
    ok: true,
    dado: {
      tipo: 'BOLETO',
      especie: 'BANCARIO',
      codigoBarras: barras,
      codigo,
      valor: v > 0 ? v : null,
      vencimento: vencimentoDoFator(Number(barras.slice(5, 9))),
      segmento: null,
    },
  };
}

function lerLinha47(d: string): ResultadoLeitura {
  const campos: Array<[string, number]> = [
    [d.slice(0, 9), Number(d[9])],
    [d.slice(10, 20), Number(d[20])],
    [d.slice(21, 31), Number(d[31])],
  ];
  for (const [c, dv] of campos) {
    if (mod10(c) !== dv) return { ok: false, erro: 'Linha digitável com dígito errado — confira os números.' };
  }
  const barras = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
  return lerBarras44(barras, d);
}

function lerLinha48(d: string): ResultadoLeitura {
  const ident = d[2];
  const usaMod10 = ident === '6' || ident === '8';
  let barras = '';
  for (let b = 0; b < 4; b++) {
    const bloco = d.slice(b * 12, b * 12 + 11);
    const dv = Number(d[b * 12 + 11]);
    const calc = usaMod10 ? mod10(bloco) : mod11Convenio(bloco);
    if (calc !== dv) return { ok: false, erro: `Linha digitável com dígito errado no bloco ${b + 1} — confira os números.` };
    barras += bloco;
  }
  return lerBarras44(barras, d);
}

// ── Pix BR Code (EMV) ──────────────────────────────────────────────────────

function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(s: string): Map<string, string> {
  const m = new Map<string, string>();
  let i = 0;
  while (i + 4 <= s.length) {
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!Number.isFinite(len)) break;
    m.set(tag, s.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return m;
}

function lerPix(codigo: string): ResultadoLeitura {
  const c = codigo.trim();
  const idx = c.lastIndexOf('6304');
  if (idx < 0 || c.length !== idx + 8) return { ok: false, erro: 'Pix copia-e-cola incompleto (faltou o final do código).' };
  if (crc16(c.slice(0, idx + 4)) !== c.slice(idx + 4).toUpperCase()) {
    return { ok: false, erro: 'Pix copia-e-cola com erro (o código de conferência não bate) — copie de novo.' };
  }
  const t = tlv(c);
  let chave: string | null = null;
  let dinamico = false;
  let info: string | null = null;
  for (let tag = 26; tag <= 51; tag++) {
    const v = t.get(String(tag));
    if (!v) continue;
    const sub = tlv(v);
    if ((sub.get('00') ?? '').toLowerCase() !== 'br.gov.bcb.pix') continue;
    chave = sub.get('01') ?? null;
    if (sub.get('25')) dinamico = true;
    info = sub.get('02') ?? null;
  }
  if (!chave && !dinamico) return { ok: false, erro: 'Esse QR não é um Pix.' };
  const valor = t.get('54') ? Number(t.get('54')) : null;
  return {
    ok: true,
    dado: {
      tipo: 'PIX',
      codigo: c,
      valor: valor && valor > 0 ? valor : null,
      favorecido: t.get('59')?.trim() || null,
      cidade: t.get('60')?.trim() || null,
      chave,
      dinamico,
      infoAdicional: info,
    },
  };
}

/** Lê o que veio colado, digitado ou do leitor (QR/ITF). */
export function lerCodigoConta(texto: string): ResultadoLeitura {
  const bruto = (texto ?? '').trim();
  if (!bruto) return { ok: false, erro: 'Cole o código, digite os números ou mande a foto/PDF da conta.' };
  if (bruto.startsWith('000201')) return lerPix(bruto);
  const d = bruto.replace(/\D/g, '');
  if (d.length === 44) return lerBarras44(d, d);
  if (d.length === 47) return lerLinha47(d);
  if (d.length === 48) return lerLinha48(d);
  return {
    ok: false,
    erro: `Código com ${d.length} números. Boleto tem 47, conta de consumo tem 48 (ou 44 no código de barras).`,
  };
}

/** Dos vários códigos achados numa foto, escolhe o que dá pra pagar
 *  (Pix ou código de barras), ignorando o QR da nota fiscal (NF3e/NFC-e). */
export function escolherCodigoPagavel(textos: string[]): ResultadoLeitura | null {
  let primeiroErro: ResultadoLeitura | null = null;
  // Código de barras primeiro (paga o valor do boleto, com baixa por convênio);
  // senão o Pix.
  const ordenados = [...textos].sort((a, b) => Number(a.trim().startsWith('000201')) - Number(b.trim().startsWith('000201')));
  for (const t of ordenados) {
    const s = t.trim();
    if (!s.startsWith('000201') && ![44, 47, 48].includes(s.replace(/\D/g, '').length)) continue;
    if (/^https?:/i.test(s)) continue;
    const r = lerCodigoConta(s);
    if (r.ok) return r;
    primeiroErro ??= r;
  }
  return primeiroErro;
}
