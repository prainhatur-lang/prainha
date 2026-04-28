// Lista de motivos pra categorizar quando user aceita uma exceção.
// Mantida igual no backend (PATCH/[id] e aceitar-todos) — qualquer
// mudança aqui exige editar nos 2 endpoints.

export const MOTIVOS = [
  'FORA_DO_TEF',
  'VENDA_DA_CASA',
  'GORJETA',
  'DESCONTO_OU_AJUSTE',
  'ESTORNO',
  'AUDITORIA_PENDENTE',
  'OUTRO',
] as const;

export type Motivo = (typeof MOTIVOS)[number];

export const MOTIVO_LABEL: Record<Motivo, string> = {
  FORA_DO_TEF: 'Fora do TEF',
  VENDA_DA_CASA: 'Venda da casa',
  GORJETA: 'Gorjeta',
  DESCONTO_OU_AJUSTE: 'Desconto / ajuste',
  ESTORNO: 'Estorno',
  AUDITORIA_PENDENTE: 'Auditoria pendente',
  OUTRO: 'Outro',
};

export const MOTIVO_DESCRICAO: Record<Motivo, string> = {
  FORA_DO_TEF: 'Pagamento standalone na maquininha sem integração com Consumer (TEF caiu, garçom passou cartão direto).',
  VENDA_DA_CASA: 'Venda direta sem fechamento de pedido no Consumer (cortesia, ajuste manual).',
  GORJETA: 'Cielo recebeu valor maior por gorjeta agregada que não foi lançada como pagamento separado no PDV.',
  DESCONTO_OU_AJUSTE: 'PDV registrou valor diferente da Cielo por desconto/ajuste manual aplicado em uma das pontas.',
  ESTORNO: 'Transação estornada após captura. PDV cancelou ou Cielo desfez.',
  AUDITORIA_PENDENTE: 'Caso suspeito que precisa investigação fora do sistema (fraude, uso indevido, etc).',
  OUTRO: 'Não se encaixa nas categorias. Detalhe na observação.',
};
