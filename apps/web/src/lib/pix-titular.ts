// Conferência da chave Pix contra o documento do fornecedor (pedido do dono,
// 22/10/2026): empresa recebe no Pix da empresa, pessoa física no Pix da
// própria pessoa — pra não pagar Pix de gente errada (fraude ou chave trocada).
//
// O que dá pra conferir sem o banco:
//  - chave CPF/CNPJ: tem que ser o documento do fornecedor (ou um CNPJ da
//    mesma empresa — mesma raiz de 8 dígitos). Outro documento = OUTRA pessoa.
//  - telefone, e-mail, aleatória: o titular não aparece na chave. Fica como
//    "não conferível" — quem paga confere o nome que o banco mostra.
// Quando o Pix cai em nome de terceiro DE PROPÓSITO (ex.: Butique da Carne →
// Elizabeth), o cadastro diz quem recebe (pix_favorecido) e o aviso vira
// "terceiro declarado", não bloqueio.

export type TipoChavePix = 'CPF' | 'CNPJ' | 'EMAIL' | 'TELEFONE' | 'ALEATORIA' | 'DESCONHECIDA';

export type NivelPix = 'ok' | 'terceiro' | 'nao_conferivel' | 'diverge';

export interface ConferenciaPix {
  tipo: TipoChavePix;
  nivel: NivelPix;
  /** Frase curta pra tela. */
  msg: string;
}

const so = (s: string) => s.replace(/\D/g, '');

export function cpfValido(v: string): boolean {
  const d = so(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const dv = ((s * 10) % 11) % 10;
    if (dv !== Number(d[n])) return false;
  }
  return true;
}

export function cnpjValido(v: string): boolean {
  const d = so(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * pesos[i]!;
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function tipoChavePix(chave: string): TipoChavePix {
  const c = chave.trim();
  if (!c) return 'DESCONHECIDA';
  if (c.includes('@')) return 'EMAIL';
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(c)) return 'ALEATORIA';
  if (c.startsWith('+')) return 'TELEFONE';
  const d = so(c);
  // Só dígitos e pontuação de documento/telefone
  if (!/^[\d.\-/()\s]+$/.test(c)) return 'DESCONHECIDA';
  if (d.length === 14 && cnpjValido(d)) return 'CNPJ';
  // 11 dígitos: CPF válido é CPF; senão é celular com DDD.
  if (d.length === 11 && cpfValido(d)) return 'CPF';
  if (d.length >= 10 && d.length <= 13) return 'TELEFONE';
  return 'DESCONHECIDA';
}

const fmtDoc = (d: string) =>
  d.length === 14
    ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');

/**
 * Confere a chave contra o CPF/CNPJ do fornecedor.
 * `favorecido` = nome de quem recebe quando NÃO é o próprio fornecedor.
 */
export function conferirChavePix(p: {
  chave: string | null | undefined;
  docFornecedor: string | null | undefined;
  favorecido?: string | null;
}): ConferenciaPix | null {
  const chave = p.chave?.trim();
  if (!chave) return null;
  const tipo = tipoChavePix(chave);
  // Documento inválido (ex.: 999.000.000-01 de cadastro provisório) = sem documento.
  const docBruto = so(p.docFornecedor ?? '');
  const doc = cnpjValido(docBruto) || cpfValido(docBruto) ? docBruto : '';
  const ehPJ = doc.length === 14;
  const ehPF = doc.length === 11;
  const terceiro = !!p.favorecido?.trim();

  if (tipo === 'CPF' || tipo === 'CNPJ') {
    const d = so(chave);
    if (!ehPJ && !ehPF) {
      return {
        tipo,
        nivel: 'nao_conferivel',
        msg: `Fornecedor sem CPF/CNPJ válido no cadastro — não dá pra conferir se a chave ${tipo} é dele.`,
      };
    }
    if (d === doc) {
      return { tipo, nivel: 'ok', msg: `✓ Chave é o ${tipo} do próprio fornecedor` };
    }
    if (tipo === 'CNPJ' && ehPJ && d.slice(0, 8) === doc.slice(0, 8)) {
      return { tipo, nivel: 'ok', msg: '✓ Chave é CNPJ da mesma empresa (outra filial)' };
    }
    const quem =
      tipo === 'CPF'
        ? ehPJ
          ? 'o CPF de uma pessoa física, mas o fornecedor é empresa'
          : 'o CPF de OUTRA pessoa'
        : ehPF
          ? 'o CNPJ de uma empresa, mas o fornecedor é pessoa física'
          : 'o CNPJ de OUTRA empresa';
    if (terceiro) {
      return {
        tipo,
        nivel: 'terceiro',
        msg: `⚠ Chave é ${quem} (${fmtDoc(d)}) — cadastrada como recebendo em nome de ${p.favorecido!.trim()}`,
      };
    }
    return {
      tipo,
      nivel: 'diverge',
      msg: `🚫 Chave é ${quem} (${fmtDoc(d)}). Fornecedor: ${fmtDoc(doc)}.${
        tipo === 'CNPJ' && ehPF ? ' Se é o MEI da própria pessoa, preencha "quem recebe" com o nome do MEI.' : ''
      }`,
    };
  }

  const nomeTipo =
    tipo === 'EMAIL' ? 'e-mail' : tipo === 'TELEFONE' ? 'telefone' : tipo === 'ALEATORIA' ? 'aleatória' : 'chave';
  if (terceiro) {
    return {
      tipo,
      nivel: 'terceiro',
      msg: `⚠ Chave ${nomeTipo} em nome de ${p.favorecido!.trim()} — confira esse nome no banco antes de pagar`,
    };
  }
  return {
    tipo,
    nivel: 'nao_conferivel',
    msg: `Chave ${nomeTipo}: o titular não aparece na chave — confira no banco se o nome é o do fornecedor${
      ehPJ ? ' (empresa)' : ehPF ? '' : ''
    }. Preferível: chave ${ehPJ ? 'CNPJ' : ehPF ? 'CPF' : 'CPF/CNPJ'}.`,
  };
}

/** Confere o CPF/CNPJ de quem RECEBEU (o Inter devolve depois do Pix). */
export function recebedorBate(p: {
  recebedorDoc: string | null | undefined;
  docFornecedor: string | null | undefined;
}): boolean | null {
  const r = so(p.recebedorDoc ?? '');
  const d = so(p.docFornecedor ?? '');
  if (!r || !d) return null;
  // O Inter costuma mascarar CPF (***.456.789-**): compara só os dígitos visíveis.
  if (r.length < d.length) return d.includes(r);
  if (r === d) return true;
  return r.length === 14 && d.length === 14 && r.slice(0, 8) === d.slice(0, 8);
}
