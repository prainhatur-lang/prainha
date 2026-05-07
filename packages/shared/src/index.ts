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

// ---- Financeiro (espelho tabelas Consumer) ----

export interface FornecedorIngest {
  codigoExterno: number;
  cnpjOuCpf: string | null;
  nome: string | null;
  razaoSocial: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  email: string | null;
  fonePrincipal: string | null;
  foneSecundario: string | null;
  rgOuIe: string | null;
  dataDelete: string | null;
  versaoReg: number | null;
}

export interface CategoriaContaIngest {
  codigoExterno: number;
  codigoPaiExterno: number | null;
  codigoGrupoDreExterno: number | null;
  descricao: string | null;
  tipo: string | null;
  excluidaEm: string | null;
  versaoReg: number | null;
}

export interface ContaBancariaIngest {
  codigoExterno: number;
  descricao: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  dataDelete: string | null;
  versaoReg: number | null;
}

export interface ContaPagarIngest {
  codigoExterno: number;
  codigoFornecedorExterno: number | null;
  codigoCategoriaExterno: number | null;
  codigoContaBancariaExterno: number | null;
  parcela: number | null;
  totalParcelas: number | null;
  dataVencimento: string; // YYYY-MM-DD
  valor: number;
  dataPagamento: string | null;
  descontos: number | null;
  jurosMulta: number | null;
  valorPago: number | null;
  codigoReferencia: string | null;
  competencia: string | null;
  descricao: string | null;
  observacao: string | null;
  dataCadastro: string | null;
  dataDelete: string | null;
  versaoReg: number | null;
}

export interface ClienteIngest {
  codigoExterno: number;
  cpfOuCnpj: string | null;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  /** Saldo atual da conta corrente (fiado). > 0 = cliente deve. */
  saldoAtualContaCorrente: number | null;
  /** Limite de credito de fiado. */
  limiteCreditoContaCorrente: number | null;
  /** S = arquivar (Consumer oculta de contacorrente). */
  arquivarFiado: boolean | null;
  dataDelete: string | null;
  versaoReg: number | null;
}

export interface MovimentoContaCorrenteIngest {
  codigoExterno: number;
  codigoClienteExterno: number | null;
  codigoPedidoExterno: number | null;
  dataHora: string | null;
  saldoInicial: number | null;
  credito: number | null;
  debito: number | null;
  saldoFinal: number | null;
  codigoPagamento: number | null;
  codigoUsuario: number | null;
  codigoContaEstornada: number | null;
  observacao: string | null;
  importado: string | null;
  versaoReg: number | null;
}

// ---- PDV / Vendas (espelho Consumer) ----

export interface ProdutoIngest {
  codigoExterno: number;
  nome: string | null;
  descricao: string | null;
  codigoPersonalizado: string | null;
  codigoEtiqueta: string | null;
  precoVenda: number | null;
  precoCusto: number | null;
  estoqueAtual: number | null;
  estoqueMinimo: number | null;
  estoqueControlado: boolean | null;
  descontinuado: boolean | null;
  itemPorKg: boolean | null;
  codigoUnidadeComercial: number | null;
  codigoProdutoTipo: number | null;
  codigoCozinha: number | null;
  ncm: string | null;
  cfop: string | null;
  cest: string | null;
  versaoReg: number | null;
  /** ISO-8601 quando pausado (null = ativo). Vem do MIN(DATAPAUSADO) do PRODUTODETALHE */
  dataPausado: string | null;
}

export interface PedidoIngest {
  codigoExterno: number;
  numero: number | null;
  senha: string | null;
  codigoClienteContatoExterno: number | null;
  codigoClienteFiadoExterno: number | null;
  nomeCliente: string | null;
  codigoColaborador: number | null;
  codigoUsuarioCriador: number | null;
  dataAbertura: string | null;
  dataFechamento: string | null;
  valorTotal: number | null;
  valorTotalItens: number | null;
  subtotalPago: number | null;
  totalDesconto: number | null;
  percentualDesconto: number | null;
  totalAcrescimo: number | null;
  totalServico: number | null;
  percentualTaxaServico: number | null;
  valorEntrega: number | null;
  valorTroco: number | null;
  valorIva: number | null;
  quantidadePessoas: number | null;
  notaEmitida: boolean | null;
  tag: string | null;
  codigoPedidoOrigem: number | null;
  codigoCupom: number | null;
  dataDelete: string | null;
  versaoReg: number | null;
}

export interface PedidoItemIngest {
  codigoExterno: number;
  codigoPedidoExterno: number;
  codigoProdutoExterno: number | null;
  nomeProduto: string | null;
  quantidade: number | null;
  valorUnitario: number | null;
  precoCusto: number | null;
  valorItem: number | null;
  valorComplemento: number | null;
  valorFilho: number | null;
  valorDesconto: number | null;
  valorGorjeta: number | null;
  valorTotal: number | null;
  codigoPai: number | null;
  codigoItemPedidoTipo: number | null;
  codigoPagamento: number | null;
  codigoColaborador: number | null;
  dataHoraCadastro: string | null;
  dataDelete: string | null;
  detalhes: string | null;
  versaoReg: number | null;
}

export interface PdvIngestBatch {
  produtos?: ProdutoIngest[];
  pedidos?: PedidoIngest[];
  pedidoItens?: PedidoItemIngest[];
}

export interface FinanceiroIngestBatch {
  fornecedores?: FornecedorIngest[];
  categorias?: CategoriaContaIngest[];
  contasBancarias?: ContaBancariaIngest[];
  contasPagar?: ContaPagarIngest[];
  clientes?: ClienteIngest[];
  movimentosContaCorrente?: MovimentoContaCorrenteIngest[];
}
