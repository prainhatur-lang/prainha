// Parser CNAB 240 - Extrato Banco Inter (segmento E)
// Validado em /tmp/fbtest/parse_cnab.js contra dados reais.

export interface CnabLancamento {
  dataMovimento: string; // dd/mm/yyyy
  dataExecucao: string;
  /** C = credito, D = debito */
  tipo: 'C' | 'D';
  valor: number;
  codigoHistorico: string;
  descricao: string;
  idTransacao: string;
}

export function parseCnab240Inter(content: Buffer | string): CnabLancamento[] {
  const text = typeof content === 'string' ? content : Buffer.from(content).toString('latin1');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 50);

  const movs: CnabLancamento[] = [];
  for (const line of lines) {
    if (line[7] !== '3') continue; // tipo 3 = detalhe
    if (line[13] !== 'E') continue; // segmento E = extrato

    // Padrao observado: ... S DDMMYYYY DDMMYYYY 18digitos C/D 7digitos descricao(25) id(15)
    const m = line.match(/S(\d{8})(\d{8})(\d{18})([CD])(\d{7})(.{25})(.{15})/);
    if (!m) continue;

    const dataMov = formatDate(m[1]!);
    const dataExe = formatDate(m[2]!);
    const valor = parseInt(m[3]!, 10) / 100;
    const tipo = m[4] as 'C' | 'D';
    const codigoHistorico = m[5]!;
    const descricao = m[6]!.trim();
    const idTransacao = m[7]!.trim();

    movs.push({ dataMovimento: dataMov, dataExecucao: dataExe, tipo, valor, codigoHistorico, descricao, idTransacao });
  }
  return movs;
}

function formatDate(ddmmyyyy: string): string {
  return `${ddmmyyyy.substring(0, 2)}/${ddmmyyyy.substring(2, 4)}/${ddmmyyyy.substring(4, 8)}`;
}

export interface CnabIdentificacao {
  /** CNPJ (14 dígitos) ou CPF (11 dígitos) extraído do header arquivo */
  inscricao: string | null;
  /** "1" = CPF | "2" = CNPJ | null */
  tipoInscricao: '1' | '2' | null;
  /** Agência (apenas dígitos, sem DV) */
  agencia: string | null;
  /** Conta (apenas dígitos, sem DV) */
  conta: string | null;
}

/**
 * Extrai CNPJ/CPF + agência/conta do header arquivo (record type 0) do CNAB 240 Inter.
 * Layout observado:
 *   posições 17    : tipoInscricao (1=CPF, 2=CNPJ)
 *   posições 18-31 : inscrição (14 dígitos pra CNPJ; 11 + 3 zeros pra CPF)
 *   posições 52-56 : agência (5 dígitos)
 *   posições 57    : DV agência
 *   posições 58-69 : conta (12 dígitos)
 *   posições 70    : DV conta
 */
export function extrairIdentificacaoCnab(content: Buffer | string): CnabIdentificacao {
  const text = typeof content === 'string' ? content : Buffer.from(content).toString('latin1');
  const lines = text.split(/\r?\n/);
  const empty: CnabIdentificacao = {
    inscricao: null,
    tipoInscricao: null,
    agencia: null,
    conta: null,
  };
  // Header arquivo é a primeira linha tipo 0 (posição 7 = '0')
  const header = lines.find((l) => l.length > 100 && l[7] === '0');
  if (!header) return empty;

  const tipoChar = header.substring(17, 18);
  const tipoInscricao = tipoChar === '1' || tipoChar === '2' ? (tipoChar as '1' | '2') : null;
  const inscRaw = header.substring(18, 32).trim();
  // Pra CNPJ (tipo=2) usa 14 dígitos. Pra CPF (tipo=1), os 14 começam com 3 zeros + 11.
  const inscricao = inscRaw.replace(/\D/g, '').replace(/^0+/, '') || null;

  // Agência+conta: posições 52-70 aproximadamente. Layout Inter pode variar
  // mas o bloco "0000190000147570786" tem 19 chars: 5(ag) + 1(DV) + 12(conta) + 1(DV).
  const blocoConta = header.substring(52, 71);
  let agencia: string | null = null;
  let conta: string | null = null;
  const m = blocoConta.match(/^(\d{5})(\d)(\d{12})(\d)$/);
  if (m) {
    agencia = m[1]!.replace(/^0+/, '') || '0';
    conta = m[3]!.replace(/^0+/, '') || '0';
  }

  return {
    inscricao,
    tipoInscricao,
    agencia,
    conta,
  };
}
