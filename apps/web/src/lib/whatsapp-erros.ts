// Erros da Meta (WhatsApp Cloud API) em português. O texto cru vem em inglês e,
// na recusa que chega pelo webhook, repetido ("Business eligibility payment issue"
// 2x — título e mensagem iguais). Sem dependência de servidor: a tela também usa.

export type MotivoErroWhatsapp =
  | 'pagamento'
  | 'janela'
  | 'modelo_diferente'
  | 'modelo_inexistente'
  | 'modelo_pausado'
  | 'sem_whatsapp'
  | 'limite_meta'
  | 'conta_bloqueada';

/** O que a Meta devolve em `statuses[].errors[]` do webhook. */
export interface ErroStatusMeta {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
}

/**
 * Texto do erro de entrega: código na frente e cada parte uma vez só. Mantém o
 * título original (quem procura "Re-engagement" no texto continua achando).
 */
export function textoErroStatus(e: ErroStatusMeta): string {
  const partes: string[] = [];
  for (const p of [e.title, e.message, e.error_data?.details]) {
    const t = (p ?? '').trim();
    if (t && !partes.some((x) => x.toLowerCase() === t.toLowerCase())) partes.push(t);
  }
  return `${e.code ? `(#${e.code}) ` : ''}${partes.join(' — ')}`.trim();
}

const tem = (erro: string, ...codigos: number[]) => codigos.some((c) => new RegExp(`\\b${c}\\b`).test(erro));

export function motivoErroWhatsapp(erro: string | null | undefined): MotivoErroWhatsapp | null {
  if (!erro) return null;
  if (tem(erro, 131042) || /payment issue|payment method/i.test(erro)) return 'pagamento';
  if (tem(erro, 131047) || /re-?engagement/i.test(erro)) return 'janela';
  if (tem(erro, 132000, 132012, 132018)) return 'modelo_diferente';
  if (tem(erro, 132001)) return 'modelo_inexistente';
  if (tem(erro, 132015, 132016)) return 'modelo_pausado';
  if (tem(erro, 131026)) return 'sem_whatsapp';
  if (tem(erro, 131048, 131049, 131056, 130429, 130472)) return 'limite_meta';
  if (tem(erro, 131031)) return 'conta_bloqueada';
  return null;
}

const EXPLICACAO: Record<MotivoErroWhatsapp, string> = {
  pagamento:
    'A Meta recusou: a conta do WhatsApp da casa está sem forma de pagamento válida (ou sem saldo). Enquanto isso ela só deixa responder quem escreveu pra casa nas últimas 24 h.',
  janela:
    'Fora da janela de 24 h: mensagem longa só entra pra quem escreveu pro número da casa nas últimas 24 h.',
  modelo_diferente: 'O envio não bateu com o modelo que está na Meta (texto, variáveis ou botão diferentes).',
  modelo_inexistente: 'A Meta não achou o modelo aprovado com esse nome e idioma.',
  modelo_pausado: 'A Meta pausou ou desativou esse modelo.',
  sem_whatsapp: 'A Meta não conseguiu entregar: o número não tem WhatsApp ou não pode receber mensagem de empresa.',
  limite_meta: 'A Meta segurou a mensagem por limite de envio — tente de novo mais tarde.',
  conta_bloqueada: 'A Meta bloqueou a conta do WhatsApp da casa — ver o aviso no Gerenciador do WhatsApp.',
};

/** Explicação em português pro erro cru da Meta, ou null quando não reconhece. */
export function explicarErroWhatsapp(erro: string | null | undefined): string | null {
  const motivo = motivoErroWhatsapp(erro);
  return motivo ? EXPLICACAO[motivo] : null;
}
