// De onde saiu o dinheiro de um pagamento manual (dono 25/11/2026: "não sai
// dinheiro do nada"). Arquivo sem banco de dados — a tela (cliente) usa.
//
// O valor do seletor é: '' (não disse) | 'banco:<nome da conta>' |
// 'banco:outro' (digita qual) | id do portador (dinheiro).

export const ORIGEM_BANCO_OUTRO = 'banco:outro';

export function origemEhBanco(origem: string): boolean {
  return origem.startsWith('banco:');
}

/** Nome da conta bancária escolhida (ou digitada); null se não é banco ou falta dizer qual. */
export function bancoDaOrigem(origem: string, outro: string): string | null {
  if (!origemEhBanco(origem)) return null;
  const nome = origem === ORIGEM_BANCO_OUTRO ? outro.trim() : origem.slice('banco:'.length).trim();
  return nome ? nome.slice(0, 60) : null;
}

/** Portador (dinheiro) escolhido; null se a origem é banco ou não foi dita. */
export function portadorDaOrigem(origem: string): string | null {
  return origem && !origemEhBanco(origem) ? origem : null;
}

/** Erro de preenchimento da origem, ou null se está completa. */
export function erroDaOrigem(origem: string, outro: string): string | null {
  if (!origem) return 'Diga de onde saiu o dinheiro: de qual conta do banco ou de qual portador (dinheiro).';
  if (origemEhBanco(origem) && !bancoDaOrigem(origem, outro)) return 'Diga de qual banco ou conta saiu o dinheiro.';
  return null;
}
