// Extrato que é planilha (pode sair em CSV). Sem dependência de servidor:
// usado na tela e na rota de download.

export function ehPlanilhaExtrato(nome: string): boolean {
  return /\.(xlsx|xls|ods)$/i.test(nome);
}

export function nomeCsvExtrato(nome: string): string {
  return nome.replace(/\.(xlsx|xls|ods)$/i, '.csv');
}
