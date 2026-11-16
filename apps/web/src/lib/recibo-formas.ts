// Formas de pagamento do recibo avulso — arquivo à parte porque a tela
// (cliente) não pode puxar lib/recibo-avulso (usa node:crypto e o banco).
export const FORMAS_RECIBO = ['Dinheiro', 'Pix', 'Transferência', 'Cartão', 'Cheque'] as const;
export type FormaRecibo = (typeof FORMAS_RECIBO)[number];
