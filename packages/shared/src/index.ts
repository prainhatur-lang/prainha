// Tipos compartilhados entre o agente local, a API e o front

export type Role = 'DONO' | 'GERENTE';

export type EtapaConciliacao =
  | 'COMPLETO'
  | 'NAO_NA_CIELO_VENDA'
  | 'SEM_AGENDA_RECEBIVEL'
  | 'NAO_PAGO_NO_BANCO'
  | 'DIVERGENCIA_VALOR';

export type Adquirente = 'CIELO' | 'STONE' | 'REDE' | 'PAGSEGURO' | 'OUTROS';

export type FormaPagamento =
  | 'DINHEIRO'
  | 'CREDITO'
  | 'DEBITO'
  | 'PIX'
  | 'VOUCHER'
  | 'OUTROS';

export interface PagamentoIngest {
  /** ID do pagamento no Consumer (PAGAMENTOS.CODIGO) */
  codigoExterno: number;
  codigoPedidoExterno: number | null;
  formaPagamento: string | null;
  valor: number;
  percentualTaxa: number | null;
  dataPagamento: string | null; // ISO
  dataCredito: string | null;
  nsuTransacao: string | null;
  numeroAutorizacaoCartao: string | null;
  bandeiraMfe: string | null;
  adquirenteMfe: string | null;
  nroParcela: number | null;
  codigoCredenciadoraCartao: number | null;
  codigoContaCorrente: number | null;
}
