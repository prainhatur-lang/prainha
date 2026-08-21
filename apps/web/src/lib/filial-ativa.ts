// Filial ativa: a escolha do usuário gruda entre as telas (cookie), pra não ter
// que trocar de filial em toda página. Precedência:
//   1. ?filialId= na URL  — link compartilhado abre na filial certa
//   2. cookie             — o que o usuário escolheu no menu
//   3. primeira filial    — fallback de sempre
import { cookies } from 'next/headers';

export const COOKIE_FILIAL = 'filial_ativa';

/** Um ano: a escolha é preferência de trabalho, não sessão. */
export const COOKIE_FILIAL_MAX_AGE = 60 * 60 * 24 * 365;

export async function escolherFilial<T extends { id: string }>(
  filiais: T[],
  filialIdDaUrl?: string,
): Promise<T | null> {
  if (filialIdDaUrl) {
    const daUrl = filiais.find((f) => f.id === filialIdDaUrl);
    if (daUrl) return daUrl;
  }

  const doCookie = (await cookies()).get(COOKIE_FILIAL)?.value;
  if (doCookie) {
    // Se o cookie aponta pra filial que o usuário perdeu acesso, cai no fallback.
    const escolhida = filiais.find((f) => f.id === doCookie);
    if (escolhida) return escolhida;
  }

  return filiais[0] ?? null;
}
