// Resposta de cotação que não se compara com o pedido (dono 21/10/2026, #38 do
// Bar): item pedido em cx/peça e o fornecedor deu o preço do kg sem dizer o
// peso, ou escreveu "c/ 16 cx" querendo dizer caixa de 16 kg. A aprovação
// escolhe pelo menor preço normalizado — sem acerto sai pedido errado.
// Usado na tela de Respostas (⚠ + botões de acerto) e no aviso da cotação.

/** Item pedido numa unidade que não diz o peso (cx, peça, un, pct…). */
export function unidadeSemPeso(unidade: string): boolean {
  return !['kg', 'g', 'l', 'lt', 'litro', 'ml'].includes(unidade.toLowerCase());
}

/**
 * Quantas unidades vêm dentro, lido da observação do fornecedor
 * ("cx vem com 20 unid valor 179.80" → 20). null = não achou.
 */
export function qtdDentroDaObservacao(observacao: string | null | undefined): number | null {
  const m = (observacao ?? '').match(/(\d+)\s*(unid|unidades|un\b|und\b|latas?|garrafas?|pacotes?|pct)/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 1 && n <= 1000 ? n : null;
}

/** null = resposta normal. */
export function alertaUnidadeResposta(
  unidadeItem: string,
  embalagem: string | null,
  fator: number,
  observacao?: string | null,
): string | null {
  if (!unidadeSemPeso(unidadeItem)) return null;
  const emb = (embalagem ?? '').toLowerCase();
  if (emb.startsWith('kg (1 ')) return null; // já veio com o peso
  if (emb.startsWith('un (1 ')) return null; // já convertido da unidade de dentro
  if (emb.startsWith('✓')) return null; // gestor já conferiu (ajustar-resposta)
  // Dono 21/10 (#38): "Valor da unid do óleo, cx vem com 20 unid" — o número é
  // da garrafa/pacote de dentro, não da cx/fardo pedido.
  if (fator === 1 && /\b(valor|pre[cç]o)\s+(da|de|por)\s+(unid|unidade|garrafa|lata|pacote)/i.test(observacao ?? ''))
    return `preço da unidade de dentro? diga quantas vêm na ${unidadeItem}`;
  if (fator === 1 && /\b(kg|kgs|kilo|kilos|quilo|quilos|kl)\b/.test(emb))
    return `preço do kg — falta o peso da ${unidadeItem}; não compara`;
  const m = emb.match(/c\/\s*([\d.,]+)\s*(\S+)/);
  if (fator > 1 && m && m[2].replace(/\.$/, '') === unidadeItem.toLowerCase())
    return `confira: ${m[1]} ${unidadeItem} juntas, ou 1 ${unidadeItem} com ${m[1]} dentro (un ou kg)?`;
  return null;
}
