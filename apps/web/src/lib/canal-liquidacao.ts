// Constantes e heurística do canal de liquidação.
// Usado pelo ingest (auto-criar entries), pela UI (cores/labels) e pela
// engine (decidir qual cascata roda em qual forma).

export const CANAIS_LIQUIDACAO = ['ADQUIRENTE', 'DIRETO', 'CAIXA', 'INTERNA'] as const;
export type CanalLiquidacao = (typeof CANAIS_LIQUIDACAO)[number];

export const CANAL_LABEL: Record<CanalLiquidacao, string> = {
  ADQUIRENTE: 'Adquirente',
  DIRETO: 'Direto na conta',
  CAIXA: 'Caixa (dinheiro)',
  INTERNA: 'Interna (fiado/vale)',
};

export const CANAL_DESC: Record<CanalLiquidacao, string> = {
  ADQUIRENTE: 'Passa por Cielo/Stone/Rede. Bate em PDV → Cielo → Banco.',
  DIRETO: 'Vai direto pra conta da empresa (sem maquininha). Bate em PDV → Banco.',
  CAIXA: 'Fica em dinheiro físico. Confere no fechamento de caixa.',
  INTERNA: 'Não envolve banco — vira contas a receber (fiado, vale).',
};

export const CANAL_COR: Record<CanalLiquidacao, string> = {
  ADQUIRENTE: 'bg-sky-100 text-sky-800',
  DIRETO: 'bg-violet-100 text-violet-800',
  CAIXA: 'bg-amber-100 text-amber-800',
  INTERNA: 'bg-slate-100 text-slate-700',
};

/**
 * Sugere um canal a partir do texto da forma de pagamento (case-insensitive).
 * Mantida em sync com a heurística do migrate-canal-liquidacao.ts.
 */
export function sugerirCanal(forma: string): CanalLiquidacao {
  const f = forma.toLowerCase();
  if (/\bdinheiro\b|\bespecie\b|esp[ée]cie/.test(f)) return 'CAIXA';
  if (/\bfiado\b|\bvale\b|funcion[áa]rio|consumo\s*interno|cortesia/.test(f)) {
    return 'INTERNA';
  }
  if (/pix\s*manual|pix\s*direto|pix\s*recebido|\bted\b|\bdoc\b|transfer[êe]ncia/.test(f)) {
    return 'DIRETO';
  }
  return 'ADQUIRENTE';
}
