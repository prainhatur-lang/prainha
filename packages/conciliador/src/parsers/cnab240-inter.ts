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
