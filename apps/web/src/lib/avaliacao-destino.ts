// Pra onde a nota alta leva o cliente (filial.avaliacao_destino). Os botões do
// Google e do TripAdvisor aparecem sempre que há link; o destino só decide
// qual deles ABRE SOZINHO depois do obrigado. Sem dependência de servidor: é
// usado na tela pública, na configuração e nas rotas.

export const DESTINOS_AVALIACAO = ['google', 'tripadvisor', 'escolher'] as const;
export type DestinoAvaliacao = (typeof DESTINOS_AVALIACAO)[number];

/** Valor desconhecido ou vazio vira 'google' — o comportamento de sempre. */
export function normalizarDestino(v: unknown): DestinoAvaliacao {
  return (DESTINOS_AVALIACAO as readonly unknown[]).includes(v) ? (v as DestinoAvaliacao) : 'google';
}

export interface LinkAutomatico {
  url: string;
  nome: 'Google' | 'TripAdvisor';
}

/** O link que abre sozinho na nota alta, ou null quando nada abre.
 *  - 'google': o do Google; sem ele nada abre (igual a antes desta opção).
 *  - 'tripadvisor': o do TripAdvisor; se a filial ficou sem ele, cai no Google
 *    pra o cliente satisfeito não ficar sem convite.
 *  - 'escolher': nada abre, o cliente toca no botão que quiser. */
export function linkAutomatico(
  destino: DestinoAvaliacao,
  googleUrl: string | null,
  tripadvisorUrl: string | null,
): LinkAutomatico | null {
  if (destino === 'escolher') return null;
  if (destino === 'tripadvisor' && tripadvisorUrl) return { url: tripadvisorUrl, nome: 'TripAdvisor' };
  return googleUrl ? { url: googleUrl, nome: 'Google' } : null;
}
