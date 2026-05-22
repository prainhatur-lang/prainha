// Mappers Consumer (Firebird) -> concilia (Postgres) pro endpoint /api/concilia/sync.
//
// Cada mapper transforma uma linha bruta da tabela do Firebird na shape que
// o Drizzle espera, e dispara o upsert/delete na tabela correspondente.
//
// Tabelas SEM mapper retornam status='nao_implementado' e o agente
// marca como processado mesmo assim (pra nao re-tentar) com um warning.
//
// FONTE: ver memory/consumer_decisoes_finais_cdc.md pra mapeamento completo
// das 55 tabelas. Por agora implemento so as que JA tem schema no concilia.

import { db, schema } from '@concilia/db';
import { eq, and, sql as drizzleSql } from 'drizzle-orm';

type Dados = Record<string, unknown>;

export type Operacao = 'I' | 'U' | 'D';

export interface RegistroSync {
  tabela: string;       // Nome da tabela Firebird (UPPERCASE)
  operacao: Operacao;   // I, U, D
  chavePk: string;      // CODIGO/ID/etc da PK
  dados: Dados | null;  // null pra DELETE
}

export interface ResultadoMap {
  status: 'ok' | 'nao_implementado' | 'erro';
  msg?: string;
}

// ---------- Helpers ----------

/** Converte BigInt/string/Date pra Number/null/ISO conforme caso. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v).trim() || null;
}

function bool(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.toUpperCase().trim();
    if (s === 'T' || s === 'S' || s === '1' || s === 'TRUE') return true;
    if (s === 'F' || s === 'N' || s === '0' || s === 'FALSE') return false;
  }
  return null;
}

function date(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Converte numero pra string (drizzle numeric espera string) */
function numStr(v: unknown): string | null {
  const n = num(v);
  return n === null ? null : n.toString();
}

// ---------- Mappers ----------

async function mapProdutos(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    // Soft delete: marca como descontinuado
    await db
      .update(schema.produto)
      .set({ descontinuado: true })
      .where(and(
        eq(schema.produto.filialId, filialId),
        eq(schema.produto.codigoExterno, codigoExterno),
      ));
    return { status: 'ok' };
  }

  const row = {
    filialId,
    codigoExterno,
    nome: str(d.NOME),
    descricao: str(d.DESCRICAO),
    codigoPersonalizado: str(d.CODIGOPERSONALIZADO),
    codigoEtiqueta: str(d.CODIGOETIQUETA),
    precoVenda: numStr(d.PRECOVENDA),
    precoCusto: numStr(d.PRECOCUSTO),
    estoqueAtual: numStr(d.ESTOQUEATUAL),
    estoqueMinimo: numStr(d.ESTOQUEMINIMO),
    estoqueControlado: bool(d.ESTOQUECONTROLADO),
    descontinuado: bool(d.DESCONTINUADO),
    itemPorKg: bool(d.ITEMPORKG),
    codigoUnidadeComercial: num(d.CODIGOUNIDADECOMERCIAL),
    codigoProdutoTipo: num(d.CODIGOPRODUTOTIPO),
    codigoCozinha: num(d.CODIGOCOZINHA),
    ncm: str(d.NCM),
    cfop: str(d.CFOP),
    cest: str(d.CEST),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };

  await db
    .insert(schema.produto)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.produto.filialId, schema.produto.codigoExterno],
      set: {
        nome: row.nome,
        descricao: row.descricao,
        precoVenda: row.precoVenda,
        precoCusto: row.precoCusto,
        estoqueAtual: row.estoqueAtual,
        estoqueMinimo: row.estoqueMinimo,
        estoqueControlado: row.estoqueControlado,
        descontinuado: row.descontinuado,
        itemPorKg: row.itemPorKg,
        codigoUnidadeComercial: row.codigoUnidadeComercial,
        codigoProdutoTipo: row.codigoProdutoTipo,
        codigoCozinha: row.codigoCozinha,
        ncm: row.ncm,
        cfop: row.cfop,
        cest: row.cest,
        versaoReg: row.versaoReg,
        sincronizadoEm: row.sincronizadoEm,
      },
    });

  return { status: 'ok' };
}

async function mapCategoriaContas(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  // CATEGORIACONTAS no Consumer eh global, mas concilia tem por filial
  if (op === 'D') {
    await db
      .update(schema.categoriaConta)
      .set({ excluidaEm: new Date() })
      .where(and(
        eq(schema.categoriaConta.filialId, filialId),
        eq(schema.categoriaConta.codigoExterno, codigoExterno),
      ));
    return { status: 'ok' };
  }

  const row = {
    filialId,
    codigoExterno,
    descricao: str(d.DESCRICAO) ?? '',
    tipo: str(d.TIPO),
    codigoPaiExterno: num(d.CODIGOPAI),
    codigoGrupoDreExterno: num(d.CODIGOGRUPODRE),
    versaoReg: num(d.VERSAOREG),
    excluidaEm: date(d.EXCLUIDAEM),
    sincronizadoEm: new Date(),
  };

  await db
    .insert(schema.categoriaConta)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.categoriaConta.filialId, schema.categoriaConta.codigoExterno],
      set: {
        descricao: row.descricao,
        tipo: row.tipo,
        codigoPaiExterno: row.codigoPaiExterno,
        codigoGrupoDreExterno: row.codigoGrupoDreExterno,
        versaoReg: row.versaoReg,
        excluidaEm: row.excluidaEm,
        sincronizadoEm: row.sincronizadoEm,
      },
    });

  return { status: 'ok' };
}

async function mapFornecedores(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    // Sem soft delete claro em fornecedor — apenas log e nao mexe
    return { status: 'ok', msg: 'delete soft skipped' };
  }

  const row = {
    filialId,
    codigoExterno,
    nome: str(d.NOME),
    razaoSocial: str(d.RAZAOSOCIAL),
    cnpjOuCpf: str(d.CNPJOUCPF),
    rgOuIe: str(d.RGOUIE),
    email: str(d.EMAIL),
    fonePrincipal: str(d.FONEPRINCIPAL),
    foneSecundario: str(d.FONESECUNDARIO),
    dataDelete: date(d.DATADELETE),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };

  await db
    .insert(schema.fornecedor)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.fornecedor.filialId, schema.fornecedor.codigoExterno],
      set: {
        nome: row.nome,
        razaoSocial: row.razaoSocial,
        cnpjOuCpf: row.cnpjOuCpf,
        rgOuIe: row.rgOuIe,
        email: row.email,
        fonePrincipal: row.fonePrincipal,
        foneSecundario: row.foneSecundario,
        dataDelete: row.dataDelete,
        versaoReg: row.versaoReg,
        sincronizadoEm: row.sincronizadoEm,
      },
    });
  return { status: 'ok' };
}

// ---------- Mappers — schemas existentes ----------

async function mapPedidos(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    await db.update(schema.pedido)
      .set({ dataDelete: new Date() })
      .where(and(
        eq(schema.pedido.filialId, filialId),
        eq(schema.pedido.codigoExterno, codigoExterno),
      ));
    return { status: 'ok' };
  }

  const row = {
    filialId,
    codigoExterno,
    numero: num(d.NUMERO),
    senha: str(d.SENHA),
    codigoClienteContatoExterno: num(d.CODIGOCONTATOCLIENTE),
    codigoClienteFiadoExterno: num(d.CODIGOCONTATOFIADO),
    nomeCliente: str(d.NOME),
    codigoColaborador: num(d.CODIGOCOLABORADOR),
    codigoUsuarioCriador: num(d.CODIGOUSUARIOCRIADOR),
    dataAbertura: date(d.DATAABERTURA),
    dataFechamento: date(d.DATAFECHAMENTO),
    valorTotal: numStr(d.VALORTOTAL),
    valorTotalItens: numStr(d.VALORTOTALITENS),
    subtotalPago: numStr(d.SUBTOTALPAGO),
    totalDesconto: numStr(d.TOTALDESCONTO),
    percentualDesconto: numStr(d.PERCENTUALDESCONTO),
    totalAcrescimo: numStr(d.TOTALACRESCIMO),
    totalServico: numStr(d.TOTALSERVICO),
    percentualTaxaServico: numStr(d.PERCENTUALTAXASERVICO),
    valorEntrega: numStr(d.VALORENTREGA),
    valorTroco: numStr(d.VALORTROCO),
    valorIva: numStr(d.VALORIVA),
    quantidadePessoas: num(d.QUANTIDADEPESSOAS),
    notaEmitida: bool(d.NOTAEMITIDA),
    tag: str(d.TAG),
    codigoPedidoOrigem: num(d.CODIGOPEDIDOORIGEM),
    codigoCupom: num(d.CODIGOCUPOM),
    dataDelete: date(d.DATADELETE),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };

  await db.insert(schema.pedido).values(row).onConflictDoUpdate({
    target: [schema.pedido.filialId, schema.pedido.codigoExterno],
    set: {
      numero: row.numero,
      nomeCliente: row.nomeCliente,
      codigoClienteContatoExterno: row.codigoClienteContatoExterno,
      codigoClienteFiadoExterno: row.codigoClienteFiadoExterno,
      codigoColaborador: row.codigoColaborador,
      dataAbertura: row.dataAbertura,
      dataFechamento: row.dataFechamento,
      valorTotal: row.valorTotal,
      valorTotalItens: row.valorTotalItens,
      subtotalPago: row.subtotalPago,
      totalDesconto: row.totalDesconto,
      percentualDesconto: row.percentualDesconto,
      totalAcrescimo: row.totalAcrescimo,
      totalServico: row.totalServico,
      percentualTaxaServico: row.percentualTaxaServico,
      valorEntrega: row.valorEntrega,
      valorTroco: row.valorTroco,
      valorIva: row.valorIva,
      quantidadePessoas: row.quantidadePessoas,
      notaEmitida: row.notaEmitida,
      tag: row.tag,
      dataDelete: row.dataDelete,
      versaoReg: row.versaoReg,
      sincronizadoEm: row.sincronizadoEm,
    },
  });
  return { status: 'ok' };
}

async function mapItensPedido(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    await db.update(schema.pedidoItem)
      .set({ dataDelete: new Date() })
      .where(and(
        eq(schema.pedidoItem.filialId, filialId),
        eq(schema.pedidoItem.codigoExterno, codigoExterno),
      ));
    return { status: 'ok' };
  }

  // CODIGOPRODUTO no Consumer eh quase sempre NULL. O agente faz JOIN com
  // PRODUTODETALHE na hora de buscar (query especial em drenador.ts) e injeta
  // CODIGOPRODUTORESOLVIDO no payload. Aceita ambos campos com fallback.
  const codProd = num(d.CODIGOPRODUTORESOLVIDO) ?? num(d.CODIGOPRODUTO);

  const codigoPedidoExterno = num(d.CODIGOPEDIDO);
  if (!codigoPedidoExterno) return { status: 'erro', msg: 'codigoPedido nulo' };

  const row = {
    filialId,
    codigoExterno,
    codigoPedidoExterno,
    codigoProdutoExterno: codProd,
    nomeProduto: str(d.NOMEPRODUTO),
    quantidade: numStr(d.QUANTIDADE),
    valorUnitario: numStr(d.VALORUNITARIO),
    precoCusto: numStr(d.PRECOCUSTO),
    valorItem: numStr(d.VALORITEM),
    valorComplemento: numStr(d.VALORCOMPLEMENTO),
    valorFilho: numStr(d.VALORFILHO),
    valorDesconto: numStr(d.VALORDESCONTO),
    valorGorjeta: numStr(d.VALORGORJETA),
    valorTotal: numStr(d.VALORTOTAL),
    codigoPai: num(d.CODIGOPAI),
    codigoItemPedidoTipo: num(d.CODIGOITEMPEDIDOTIPO),
    codigoPagamento: num(d.CODIGOPAGAMENTO),
    codigoColaborador: num(d.CODIGOCOLABORADOR),
    dataHoraCadastro: date(d.DATAHORACADASTRO),
    dataDelete: date(d.DATADELETE),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };

  await db.insert(schema.pedidoItem).values(row).onConflictDoUpdate({
    target: [schema.pedidoItem.filialId, schema.pedidoItem.codigoExterno],
    set: {
      codigoPedidoExterno: row.codigoPedidoExterno,
      codigoProdutoExterno: row.codigoProdutoExterno,
      nomeProduto: row.nomeProduto,
      quantidade: row.quantidade,
      valorUnitario: row.valorUnitario,
      precoCusto: row.precoCusto,
      valorItem: row.valorItem,
      valorComplemento: row.valorComplemento,
      valorFilho: row.valorFilho,
      valorDesconto: row.valorDesconto,
      valorGorjeta: row.valorGorjeta,
      valorTotal: row.valorTotal,
      codigoPai: row.codigoPai,
      codigoItemPedidoTipo: row.codigoItemPedidoTipo,
      codigoPagamento: row.codigoPagamento,
      codigoColaborador: row.codigoColaborador,
      dataHoraCadastro: row.dataHoraCadastro,
      dataDelete: row.dataDelete,
      versaoReg: row.versaoReg,
      sincronizadoEm: row.sincronizadoEm,
    },
  });

  // Resolve FKs (pedido_id, produto_id) — best effort (pode falhar se pai
  // ainda nao chegou, agente vai re-sincronizar depois)
  await db.execute(drizzleSql`
    UPDATE pedido_item pi SET pedido_id = p.id
    FROM pedido p
    WHERE pi.filial_id = ${filialId}
      AND pi.codigo_externo = ${codigoExterno}
      AND pi.codigo_pedido_externo = p.codigo_externo
      AND p.filial_id = ${filialId}
      AND pi.pedido_id IS NULL
  `);
  if (codProd) {
    await db.execute(drizzleSql`
      UPDATE pedido_item pi SET produto_id = pr.id
      FROM produto pr
      WHERE pi.filial_id = ${filialId}
        AND pi.codigo_externo = ${codigoExterno}
        AND pi.codigo_produto_externo = pr.codigo_externo
        AND pr.filial_id = ${filialId}
        AND pi.produto_id IS NULL
    `);
  }

  return { status: 'ok' };
}

async function mapPagamentos(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    // pagamento nao tem soft-delete proprio — pular
    return { status: 'ok', msg: 'delete soft skipped' };
  }

  const valor = numStr(d.VALOR);
  if (!valor) return { status: 'erro', msg: 'valor nulo' };

  const row = {
    filialId,
    codigoExterno,
    codigoPedidoExterno: num(d.CODIGOPEDIDO),
    formaPagamento: str(d.FORMA) ?? str(d.FORMAPAGAMENTO),
    valor,
    percentualTaxa: numStr(d.PERCENTUALTAXA),
    dataPagamento: date(d.DATAPAGAMENTO),
    dataCredito: date(d.DATACREDITO),
    nsuTransacao: str(d.NSUTRANSACAO),
    numeroAutorizacaoCartao: str(d.NUMEROAUTORIZACAOCARTAO),
    bandeiraMfe: str(d.BANDEIRAMFE),
    adquirenteMfe: str(d.ADQUIRENTEMFE),
    nroParcela: num(d.NROPARCELA),
    codigoCredenciadoraCartao: num(d.CODIGOCREDENCIADORACARTAO),
    codigoContaCorrente: num(d.CODIGOCONTACORRENTE),
    sincronizadoEm: new Date(),
  };

  await db.insert(schema.pagamento).values(row).onConflictDoUpdate({
    target: [schema.pagamento.filialId, schema.pagamento.codigoExterno],
    set: {
      codigoPedidoExterno: row.codigoPedidoExterno,
      formaPagamento: row.formaPagamento,
      valor: row.valor,
      percentualTaxa: row.percentualTaxa,
      dataPagamento: row.dataPagamento,
      dataCredito: row.dataCredito,
      nsuTransacao: row.nsuTransacao,
      numeroAutorizacaoCartao: row.numeroAutorizacaoCartao,
      bandeiraMfe: row.bandeiraMfe,
      adquirenteMfe: row.adquirenteMfe,
      nroParcela: row.nroParcela,
      codigoCredenciadoraCartao: row.codigoCredenciadoraCartao,
      codigoContaCorrente: row.codigoContaCorrente,
      sincronizadoEm: row.sincronizadoEm,
    },
  });
  return { status: 'ok' };
}

async function mapContatos(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    await db.update(schema.cliente)
      .set({ dataDelete: new Date() })
      .where(and(
        eq(schema.cliente.filialId, filialId),
        eq(schema.cliente.codigoExterno, codigoExterno),
      ));
    return { status: 'ok' };
  }

  // CONTATOS no Consumer e unificado (cliente + fornecedor + colaborador).
  // Aqui sincronizamos pra tabela `cliente`. O mesmo CONTATO pode acabar tambem
  // em `fornecedor` e `colaborador` por outros caminhos (decisao D10).
  const fone = str(d.FONEPRINCIPAL) ?? str(d.FONECELULAR) ?? str(d.FONERECADOS);
  const row = {
    filialId,
    codigoExterno,
    cpfOuCnpj: str(d.CNPJOUCPF),
    nome: str(d.NOME),
    email: str(d.EMAIL),
    telefone: fone?.slice(0, 30) ?? null,
    saldoAtualContaCorrente: numStr(d.SALDOATUALCONTACORRENTE),
    limiteCreditoContaCorrente: numStr(d.LIMITECREDITOCONTACORRENTE),
    arquivarFiado: bool(d.ARQUIVARFIADO),
    dataDelete: date(d.DATADELETE),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };

  await db.insert(schema.cliente).values(row).onConflictDoUpdate({
    target: [schema.cliente.filialId, schema.cliente.codigoExterno],
    set: {
      cpfOuCnpj: row.cpfOuCnpj,
      nome: row.nome,
      email: row.email,
      telefone: row.telefone,
      saldoAtualContaCorrente: row.saldoAtualContaCorrente,
      limiteCreditoContaCorrente: row.limiteCreditoContaCorrente,
      arquivarFiado: row.arquivarFiado,
      dataDelete: row.dataDelete,
      versaoReg: row.versaoReg,
      sincronizadoEm: row.sincronizadoEm,
    },
  });
  return { status: 'ok' };
}

async function mapContaCorrente(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    // CONTACORRENTE nao tem soft-delete claro — skipa
    return { status: 'ok', msg: 'delete soft skipped' };
  }

  const row = {
    filialId,
    codigoExterno,
    codigoClienteExterno: num(d.CODIGOCLIENTE),
    codigoPedidoExterno: num(d.CODIGOPEDIDO),
    dataHora: date(d.DATAHORA),
    saldoInicial: numStr(d.SALDOINICIAL),
    credito: numStr(d.CREDITO),
    debito: numStr(d.DEBITO),
    saldoFinal: numStr(d.SALDOFINAL),
    codigoPagamento: num(d.CODIGOPAGAMENTO),
    codigoUsuario: num(d.CODIGOUSUARIO),
    codigoContaEstornada: num(d.CODIGOCONTAESTORNADA),
    observacao: str(d.OBSERVACAO),
    importado: str(d.IMPORTADO),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };

  await db.insert(schema.movimentoContaCorrente).values(row).onConflictDoUpdate({
    target: [schema.movimentoContaCorrente.filialId, schema.movimentoContaCorrente.codigoExterno],
    set: {
      codigoClienteExterno: row.codigoClienteExterno,
      codigoPedidoExterno: row.codigoPedidoExterno,
      dataHora: row.dataHora,
      saldoInicial: row.saldoInicial,
      credito: row.credito,
      debito: row.debito,
      saldoFinal: row.saldoFinal,
      codigoPagamento: row.codigoPagamento,
      codigoUsuario: row.codigoUsuario,
      codigoContaEstornada: row.codigoContaEstornada,
      observacao: row.observacao,
      importado: row.importado,
      versaoReg: row.versaoReg,
      sincronizadoEm: row.sincronizadoEm,
    },
  });

  // Resolve FK cliente_id
  await db.execute(drizzleSql`
    UPDATE movimento_conta_corrente mcc SET cliente_id = c.id
    FROM cliente c
    WHERE mcc.filial_id = ${filialId}
      AND mcc.codigo_externo = ${codigoExterno}
      AND mcc.codigo_cliente_externo = c.codigo_externo
      AND c.filial_id = ${filialId}
      AND mcc.cliente_id IS NULL
  `);
  return { status: 'ok' };
}

async function mapContasPagar(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    return { status: 'ok', msg: 'delete soft skipped' };
  }

  const dataVencimento = date(d.DATAVENCIMENTO);
  const valor = numStr(d.VALOR);
  if (!dataVencimento || !valor) return { status: 'erro', msg: 'data_vencimento ou valor nulos' };

  const row = {
    filialId,
    codigoExterno,
    codigoFornecedorExterno: num(d.CODIGOFORNECEDOR),
    codigoCategoriaExterno: num(d.CODIGOCATEGORIACONTAS),
    codigoContaBancariaExterno: num(d.CODIGOCONTABANCARIA),
    parcela: num(d.PARCELA),
    totalParcelas: num(d.TOTALPARCELAS),
    dataVencimento: dataVencimento.toISOString().slice(0, 10),
    valor,
    dataPagamento: date(d.DATAPAGAMENTO)?.toISOString().slice(0, 10),
    descontos: numStr(d.DESCONTOS),
    jurosMulta: numStr(d.JUROSMULTA),
    valorPago: numStr(d.VALORPAGO),
    codigoReferencia: str(d.CODIGOREFERENCIA),
    competencia: str(d.COMPETENCIA),
    descricao: str(d.DESCRICAO),
    observacao: str(d.OBSERVACAO),
    origem: 'CONSUMER',
  };

  await db.insert(schema.contaPagar).values(row).onConflictDoUpdate({
    target: [schema.contaPagar.filialId, schema.contaPagar.codigoExterno],
    set: {
      codigoFornecedorExterno: row.codigoFornecedorExterno,
      codigoCategoriaExterno: row.codigoCategoriaExterno,
      codigoContaBancariaExterno: row.codigoContaBancariaExterno,
      parcela: row.parcela,
      totalParcelas: row.totalParcelas,
      dataVencimento: row.dataVencimento,
      valor: row.valor,
      dataPagamento: row.dataPagamento,
      descontos: row.descontos,
      jurosMulta: row.jurosMulta,
      valorPago: row.valorPago,
      codigoReferencia: row.codigoReferencia,
      competencia: row.competencia,
      descricao: row.descricao,
      observacao: row.observacao,
    },
  });

  // Resolve FK fornecedor_id e categoria_id
  if (row.codigoFornecedorExterno) {
    await db.execute(drizzleSql`
      UPDATE conta_pagar cp SET fornecedor_id = f.id
      FROM fornecedor f
      WHERE cp.filial_id = ${filialId}
        AND cp.codigo_externo = ${codigoExterno}
        AND cp.codigo_fornecedor_externo = f.codigo_externo
        AND f.filial_id = ${filialId}
        AND cp.fornecedor_id IS NULL
    `);
  }
  if (row.codigoCategoriaExterno) {
    await db.execute(drizzleSql`
      UPDATE conta_pagar cp SET categoria_id = c.id
      FROM categoria_conta c
      WHERE cp.filial_id = ${filialId}
        AND cp.codigo_externo = ${codigoExterno}
        AND cp.codigo_categoria_externo = c.codigo_externo
        AND c.filial_id = ${filialId}
        AND cp.categoria_id IS NULL
    `);
  }
  return { status: 'ok' };
}

async function mapContasBancarias(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    await db.update(schema.contaBancariaConsumer)
      .set({ dataDelete: new Date() })
      .where(and(
        eq(schema.contaBancariaConsumer.filialId, filialId),
        eq(schema.contaBancariaConsumer.codigoExterno, codigoExterno),
      ));
    return { status: 'ok' };
  }

  const row = {
    filialId,
    codigoExterno,
    descricao: str(d.DESCRICAO),
    banco: str(d.BANCO),
    agencia: str(d.AGENCIA),
    conta: str(d.CONTA),
    dataDelete: date(d.DATADELETE),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };

  await db.insert(schema.contaBancariaConsumer).values(row).onConflictDoUpdate({
    target: [schema.contaBancariaConsumer.filialId, schema.contaBancariaConsumer.codigoExterno],
    set: {
      descricao: row.descricao,
      banco: row.banco,
      agencia: row.agencia,
      conta: row.conta,
      dataDelete: row.dataDelete,
      versaoReg: row.versaoReg,
      sincronizadoEm: row.sincronizadoEm,
    },
  });
  return { status: 'ok' };
}

// ---------- Dispatcher ----------

type Mapper = (filialId: string, op: Operacao, chave: string, d: Dados) => Promise<ResultadoMap>;

const MAPPERS: Record<string, Mapper> = {
  PRODUTOS: mapProdutos,
  CATEGORIACONTAS: mapCategoriaContas,
  FORNECEDORES: mapFornecedores,
  PEDIDOS: mapPedidos,
  ITENSPEDIDO: mapItensPedido,
  PAGAMENTOS: mapPagamentos,
  CONTATOS: mapContatos,
  CONTACORRENTE: mapContaCorrente,
  CONTASPAGAR: mapContasPagar,
  CONTASBANCARIAS: mapContasBancarias,
  // TODO: PRODUTODETALHE, PRODUTOFICHA, NFE, NFCE, CAIXA — precisam schema novo
};

export async function aplicarRegistro(filialId: string, r: RegistroSync): Promise<ResultadoMap> {
  const mapper = MAPPERS[r.tabela];
  if (!mapper) {
    return {
      status: 'nao_implementado',
      msg: `mapper ${r.tabela} ainda nao implementado`,
    };
  }
  if (r.operacao !== 'D' && !r.dados) {
    return { status: 'erro', msg: 'operacao I/U sem dados' };
  }
  try {
    return await mapper(filialId, r.operacao, r.chavePk, r.dados ?? {});
  } catch (e) {
    return { status: 'erro', msg: (e as Error).message.slice(0, 200) };
  }
}

export function tabelasComMapper(): string[] {
  return Object.keys(MAPPERS).sort();
}
