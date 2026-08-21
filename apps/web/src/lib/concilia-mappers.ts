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
        // ATENCAO: NAO sobrescrever precoCusto e estoqueAtual no UPDATE — mesma
        // regra do /api/ingest/pdv. Esses dois sao gerenciados na nuvem via
        // movimento_estoque (ENTRADA_COMPRA da NFe, ENTRADA/SAIDA_PRODUCAO,
        // SAIDA_VENDA / SAIDA_FICHA_TECNICA, ajustes) + custo medio ponderado.
        // O CDC manda a linha CRUA de PRODUTOS, e no Consumer o estoque/custo
        // de verdade mora em PRODUTODETALHE — PRODUTOS.ESTOQUEATUAL vem 0/null.
        // Sobrescrever aqui zerava o saldo e o custo da nuvem toda vez que
        // alguem mexia no produto no Consumer.
        // Saldo inicial entra so no INSERT (produto novo), depois eh da nuvem.
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

  // ⚠️ O Consumer grava TIPO como 'P' (pagar) e 'R' (receber) — NÃO 'DESPESA'.
  // O campo daqui sempre foi documentado como RECEITA|DESPESA e as telas
  // filtram por isso; passar o 'P' cru deixava o filtro sem NENHUMA linha, e
  // o lançamento de conta a pagar aparecia SEM grupos e subgrupos (achado em
  // 21/08 — 152 categorias 'P', 101 com pai, e a tela mostrando vazio).
  const tipoConsumer = (str(d.TIPO) ?? '').trim().toUpperCase();
  const tipo = tipoConsumer === 'P' ? 'DESPESA'
    : tipoConsumer === 'R' ? 'RECEITA'
    : (str(d.TIPO) ?? null);

  const row = {
    filialId,
    codigoExterno,
    descricao: str(d.DESCRICAO) ?? '',
    tipo,
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
        // Contatos (email/telefones): só sobrescreve se o Consumer mandar valor.
        // Se vier vazio, PRESERVA o que foi cadastrado no concilia (ex.: telefone
        // do fornecedor pra cotação no WhatsApp) — senão o sync apaga toda hora.
        email: drizzleSql`COALESCE(NULLIF(excluded.email, ''), ${schema.fornecedor.email})`,
        fonePrincipal: drizzleSql`COALESCE(NULLIF(excluded.fone_principal, ''), ${schema.fornecedor.fonePrincipal})`,
        foneSecundario: drizzleSql`COALESCE(NULLIF(excluded.fone_secundario, ''), ${schema.fornecedor.foneSecundario})`,
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
    // TAMANHO vendido. O agente resolve o produto-pai e mandava só ele — sem
    // isto não dá pra saber se saiu dose ou garrafa, e a ficha por tamanho
    // baixaria a receita errada.
    codigoVarianteExterno: num(d.CODIGOPRODUTODETALHE),
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
      codigoVarianteExterno: row.codigoVarianteExterno,
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

// ---------- NF de venda (NFE + NFCE + NFITEM + NFPAGAMENTO) ----------

/** Helper interno pra inserir/atualizar cabecalho de NF (unifica NFE+NFCE). */
async function upsertNfVenda(
  filialId: string,
  tipo: 'NFE' | 'NFCE',
  op: Operacao,
  chave: string,
  d: Dados,
): Promise<ResultadoMap> {
  const codigoExterno = chave; // bigint vem como string
  if (!/^-?\d+$/.test(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    // Sem soft delete claro — situacao=cancelada via update separado
    return { status: 'ok', msg: 'delete soft skipped' };
  }

  // NFE: CODIGOPEDIDO + CODIGOSITUACAO + CODIGOTIPODOCUMENTO + NUMERODOCUMENTODESTINATARIO + TIPOEMISSAO=null
  // NFCE: PEDIDO + SITUACAONFCE + TIPOEMISSAO + SUBTOTAL + ACRESCIMO + DESCONTO
  const codigoPedidoExterno = num(d.CODIGOPEDIDO) ?? num(d.PEDIDO);
  const situacao = num(d.CODIGOSITUACAO) ?? num(d.SITUACAONFCE);

  const row = {
    filialId,
    tipo,
    codigoExterno: BigInt(codigoExterno),
    codigoPedidoExterno,
    codNfInfo: d.CODNFINFO != null ? BigInt(String(d.CODNFINFO)) : null,
    serie: num(d.SERIE),
    numero: num(d.NUMERO),
    chaveAcesso: str(d.CHAVEACESSO),
    situacao,
    dataHoraEmissao: date(d.DATAHORAEMISSAO),
    valor: numStr(d.VALOR),
    subtotal: numStr(d.SUBTOTAL),
    acrescimo: numStr(d.ACRESCIMO),
    desconto: numStr(d.DESCONTO),
    tipoEmissao: num(d.TIPOEMISSAO),
    numeroDocumentoDestinatario: str(d.NUMERODOCUMENTODESTINATARIO),
    codigoTipoDocumento: num(d.CODIGOTIPODOCUMENTO),
    codigoNumericoAleatorio: num(d.CODIGONUMERICOALEATORIO),
    protocoloCancelamento: d.PROTOCOLOCANCELAMENTO != null ? BigInt(String(d.PROTOCOLOCANCELAMENTO)) : null,
    numeroProtocolo: str(d.NUMEROPROTOCOLO),
    justificativaCancelamento: str(d.JUSTIFICATIVACANCELAMENTO),
    codigoEstacao: num(d.CODIGOESTACAO),
    consolidadoEm: date(d.CONSOLIDADOEM),
    caminhoXml: str(d.CAMINHOXML),
    sincronizadoEm: new Date(),
  };

  await db.insert(schema.nfVenda).values(row).onConflictDoUpdate({
    target: [schema.nfVenda.filialId, schema.nfVenda.tipo, schema.nfVenda.codigoExterno],
    set: {
      codigoPedidoExterno: row.codigoPedidoExterno,
      codNfInfo: row.codNfInfo,
      serie: row.serie,
      numero: row.numero,
      chaveAcesso: row.chaveAcesso,
      situacao: row.situacao,
      dataHoraEmissao: row.dataHoraEmissao,
      valor: row.valor,
      subtotal: row.subtotal,
      acrescimo: row.acrescimo,
      desconto: row.desconto,
      tipoEmissao: row.tipoEmissao,
      numeroDocumentoDestinatario: row.numeroDocumentoDestinatario,
      codigoTipoDocumento: row.codigoTipoDocumento,
      codigoNumericoAleatorio: row.codigoNumericoAleatorio,
      protocoloCancelamento: row.protocoloCancelamento,
      numeroProtocolo: row.numeroProtocolo,
      justificativaCancelamento: row.justificativaCancelamento,
      codigoEstacao: row.codigoEstacao,
      consolidadoEm: row.consolidadoEm,
      caminhoXml: row.caminhoXml,
      sincronizadoEm: row.sincronizadoEm,
    },
  });

  // Resolve FK pedido_id
  if (codigoPedidoExterno) {
    await db.execute(drizzleSql`
      UPDATE nf_venda SET pedido_id = p.id
      FROM pedido p
      WHERE nf_venda.filial_id = ${filialId}
        AND nf_venda.tipo = ${tipo}
        AND nf_venda.codigo_externo = ${codigoExterno}::bigint
        AND nf_venda.codigo_pedido_externo = p.codigo_externo
        AND p.filial_id = ${filialId}
        AND nf_venda.pedido_id IS NULL
    `);
  }
  return { status: 'ok' };
}

const mapNfe = (filialId: string, op: Operacao, chave: string, d: Dados) =>
  upsertNfVenda(filialId, 'NFE', op, chave, d);
const mapNfce = (filialId: string, op: Operacao, chave: string, d: Dados) =>
  upsertNfVenda(filialId, 'NFCE', op, chave, d);

async function mapNfItem(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  if (!/^-?\d+$/.test(chave)) return { status: 'erro', msg: 'codigoExterno invalido' };
  if (op === 'D') return { status: 'ok', msg: 'delete soft skipped' };

  const codNfInfo = d.CODNFINFO != null ? BigInt(String(d.CODNFINFO)) : null;
  if (!codNfInfo) return { status: 'erro', msg: 'codNfInfo nulo' };

  const row = {
    filialId,
    codigoExterno: BigInt(chave),
    codNfInfo,
    codProdutoDetalhe: num(d.CODPRDUTODETALHE),
    codItemPedido: num(d.CODITEMPEDIDO),
    nItem: num(d.H02_NITEM),
    cfop: num(d.I08_CFOP),
    qCom: numStr(d.I10_QCOM),
    vUnCom: numStr(d.I10A_VUNCOM),
    vProd: numStr(d.I11_VPROD),
    qTrib: numStr(d.I14_QTRIB),
    vUnTrib: numStr(d.I14A_VUNTRIB),
    vFrete: numStr(d.I15_VFRETE),
    vSeg: numStr(d.I16_VSEG),
    vDesc: numStr(d.I17_VDESC),
    vOutro: numStr(d.I17A_VOUTRO),
    indTot: num(d.I17B_INDTOT),
    vTotTrib: numStr(d.M02_VTOTTRIB),
    cProd: str(d.I02_CPROD),
    xProd: str(d.I04_XPROD),
    infAdProd: str(d.V01_INFADPROD),
    vItem: numStr(d.VB01_VITEM),
    sincronizadoEm: new Date(),
  };

  await db.insert(schema.nfVendaItem).values(row).onConflictDoUpdate({
    target: [schema.nfVendaItem.filialId, schema.nfVendaItem.codigoExterno],
    set: {
      codNfInfo: row.codNfInfo,
      codProdutoDetalhe: row.codProdutoDetalhe,
      codItemPedido: row.codItemPedido,
      nItem: row.nItem,
      cfop: row.cfop,
      qCom: row.qCom,
      vUnCom: row.vUnCom,
      vProd: row.vProd,
      qTrib: row.qTrib,
      vUnTrib: row.vUnTrib,
      vFrete: row.vFrete,
      vSeg: row.vSeg,
      vDesc: row.vDesc,
      vOutro: row.vOutro,
      indTot: row.indTot,
      vTotTrib: row.vTotTrib,
      cProd: row.cProd,
      xProd: row.xProd,
      infAdProd: row.infAdProd,
      vItem: row.vItem,
      sincronizadoEm: row.sincronizadoEm,
    },
  });

  // Resolve FKs: nf_venda_id (via cod_nf_info) e pedido_item_id (via cod_item_pedido)
  await db.execute(drizzleSql`
    UPDATE nf_venda_item nvi SET nf_venda_id = nv.id
    FROM nf_venda nv
    WHERE nvi.filial_id = ${filialId}
      AND nvi.codigo_externo = ${chave}::bigint
      AND nvi.cod_nf_info = nv.cod_nf_info
      AND nv.filial_id = ${filialId}
      AND nvi.nf_venda_id IS NULL
  `);
  if (row.codItemPedido) {
    await db.execute(drizzleSql`
      UPDATE nf_venda_item nvi SET pedido_item_id = pi.id
      FROM pedido_item pi
      WHERE nvi.filial_id = ${filialId}
        AND nvi.codigo_externo = ${chave}::bigint
        AND nvi.cod_item_pedido = pi.codigo_externo
        AND pi.filial_id = ${filialId}
        AND nvi.pedido_item_id IS NULL
    `);
  }
  return { status: 'ok' };
}

async function mapNfPagamento(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  if (!/^-?\d+$/.test(chave)) return { status: 'erro', msg: 'codigoExterno invalido' };
  if (op === 'D') return { status: 'ok', msg: 'delete soft skipped' };

  const codNfInfo = d.CODNFINFO != null ? BigInt(String(d.CODNFINFO)) : null;
  if (!codNfInfo) return { status: 'erro', msg: 'codNfInfo nulo' };

  const row = {
    filialId,
    codigoExterno: BigInt(chave),
    codNfInfo,
    codPagamento: num(d.CODPAGAMENTO),
    indPag: num(d.YA01B_INDPAG),
    tPag: num(d.YA02_TPAG),
    vPag: numStr(d.YA03_VPAG),
    tpIntegra: num(d.YA04A_TPINTEGRA),
    tBand: num(d.YA06_TBAND),
    cAdmCsat: num(d.WA05_CADMCSAT),
    cnpj: str(d.YA05_CNPJ),
    xPag: str(d.YA02A_XPAG),
    cAut: str(d.YA07_CAUT),
    sincronizadoEm: new Date(),
  };

  await db.insert(schema.nfVendaPagamento).values(row).onConflictDoUpdate({
    target: [schema.nfVendaPagamento.filialId, schema.nfVendaPagamento.codigoExterno],
    set: {
      codNfInfo: row.codNfInfo,
      codPagamento: row.codPagamento,
      indPag: row.indPag,
      tPag: row.tPag,
      vPag: row.vPag,
      tpIntegra: row.tpIntegra,
      tBand: row.tBand,
      cAdmCsat: row.cAdmCsat,
      cnpj: row.cnpj,
      xPag: row.xPag,
      cAut: row.cAut,
      sincronizadoEm: row.sincronizadoEm,
    },
  });

  // Resolve FKs: nf_venda_id, pagamento_id
  await db.execute(drizzleSql`
    UPDATE nf_venda_pagamento nvp SET nf_venda_id = nv.id
    FROM nf_venda nv
    WHERE nvp.filial_id = ${filialId}
      AND nvp.codigo_externo = ${chave}::bigint
      AND nvp.cod_nf_info = nv.cod_nf_info
      AND nv.filial_id = ${filialId}
      AND nvp.nf_venda_id IS NULL
  `);
  if (row.codPagamento) {
    await db.execute(drizzleSql`
      UPDATE nf_venda_pagamento nvp SET pagamento_id = p.id
      FROM pagamento p
      WHERE nvp.filial_id = ${filialId}
        AND nvp.codigo_externo = ${chave}::bigint
        AND nvp.cod_pagamento = p.codigo_externo
        AND p.filial_id = ${filialId}
        AND nvp.pagamento_id IS NULL
    `);
  }
  return { status: 'ok' };
}

// ---------- Lookups globais (PRODUTOTIPO, UNIDADECOMERCIALIZACAO, PRODUTOSTAMANHOS) ----------

async function mapProdutoTipo(_filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigo = parseInt(chave, 10);
  if (!Number.isFinite(codigo)) return { status: 'erro', msg: 'codigo invalido' };
  if (op === 'D') {
    await db.delete(schema.produtoTipo).where(eq(schema.produtoTipo.codigo, codigo));
    return { status: 'ok' };
  }
  await db.insert(schema.produtoTipo)
    .values({ codigo, descricao: str(d.DESCRICAO) ?? '' })
    .onConflictDoUpdate({ target: schema.produtoTipo.codigo, set: { descricao: str(d.DESCRICAO) ?? '' } });
  return { status: 'ok' };
}

async function mapUnidadeComercializacao(_filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigo = parseInt(chave, 10);
  if (!Number.isFinite(codigo)) return { status: 'erro', msg: 'codigo invalido' };
  if (op === 'D') {
    await db.delete(schema.unidadeComercializacao).where(eq(schema.unidadeComercializacao.codigo, codigo));
    return { status: 'ok' };
  }
  await db.insert(schema.unidadeComercializacao)
    .values({ codigo, sigla: str(d.SIGLA) ?? '', descricao: str(d.DESCRICAO) ?? '' })
    .onConflictDoUpdate({ target: schema.unidadeComercializacao.codigo, set: { sigla: str(d.SIGLA) ?? '', descricao: str(d.DESCRICAO) ?? '' } });
  return { status: 'ok' };
}

async function mapProdutoTamanhoLookup(_filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigo = parseInt(chave, 10);
  if (!Number.isFinite(codigo)) return { status: 'erro', msg: 'codigo invalido' };
  if (op === 'D') {
    await db.delete(schema.produtoTamanhoLookup).where(eq(schema.produtoTamanhoLookup.codigo, codigo));
    return { status: 'ok' };
  }
  await db.insert(schema.produtoTamanhoLookup)
    .values({ codigo, sigla: str(d.SIGLA) ?? '', descricao: str(d.DESCRICAO) ?? '' })
    .onConflictDoUpdate({ target: schema.produtoTamanhoLookup.codigo, set: { sigla: str(d.SIGLA) ?? '', descricao: str(d.DESCRICAO) ?? '' } });
  return { status: 'ok' };
}

// ---------- PRODUTOTAMANHO (config por produto) ----------

async function mapProdutoTamanho(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    await db.update(schema.produtoTamanho)
      .set({ dataDelete: new Date() })
      .where(and(
        eq(schema.produtoTamanho.filialId, filialId),
        eq(schema.produtoTamanho.codigoExterno, codigoExterno),
      ));
    return { status: 'ok' };
  }

  const row = {
    filialId,
    codigoExterno,
    codigoProdutoPersonalizado: num(d.CODIGOPRODUTOPERSONALIZADO),
    qtdMaximaPartes: num(d.QTDMAXIMAPARTES),
    descricao: str(d.DESCRICAO),
    sigla: str(d.SIGLA),
    codigoGuid: str(d.CODIGOGUID),
    dataInsert: date(d.DATAINSERT),
    dataUpdate: date(d.DATAUPDATE),
    dataDelete: date(d.DATADELETE),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };

  await db.insert(schema.produtoTamanho).values(row).onConflictDoUpdate({
    target: [schema.produtoTamanho.filialId, schema.produtoTamanho.codigoExterno],
    set: {
      codigoProdutoPersonalizado: row.codigoProdutoPersonalizado,
      qtdMaximaPartes: row.qtdMaximaPartes,
      descricao: row.descricao,
      sigla: row.sigla,
      dataDelete: row.dataDelete,
      versaoReg: row.versaoReg,
      sincronizadoEm: row.sincronizadoEm,
    },
  });
  return { status: 'ok' };
}

// ---------- PRODUTODETALHE ----------

async function mapProdutoDetalhe(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    await db.update(schema.produtoVariante)
      .set({ dataDelete: new Date() })
      .where(and(
        eq(schema.produtoVariante.filialId, filialId),
        eq(schema.produtoVariante.codigoExterno, codigoExterno),
      ));
    return { status: 'ok' };
  }

  const codigoProdutoExterno = num(d.CODIGOPRODUTO);
  if (!codigoProdutoExterno) return { status: 'erro', msg: 'codigoProdutoExterno nulo' };

  const row = {
    filialId,
    codigoExterno,
    codigoProdutoExterno,
    codigoProdutoTamanhoExterno: num(d.CODIGOPRODUTOTAMANHO),
    precoCusto: numStr(d.PRECOCUSTO),
    precoVenda: numStr(d.PRECOVENDA),
    estoqueAtual: numStr(d.ESTOQUEATUAL),
    estoqueMinimo: numStr(d.ESTOQUEMINIMO),
    estoqueControlado: bool(d.ESTOQUECONTROLADO),
    codigoBarra: str(d.CODIGOBARRA),
    codigoGuid: str(d.CODIGOGUID),
    desktop: bool(d.DESKTOP),
    comandaMobile: bool(d.COMANDAMOBILE),
    cardapioDigital: bool(d.CARDAPIODIGITAL),
    menuDino: bool(d.MENUDINO),
    totem: bool(d.TOTEM),
    dataPausado: date(d.DATAPAUSADO),
    dataDelete: date(d.DATADELETE),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };

  await db.insert(schema.produtoVariante).values(row).onConflictDoUpdate({
    target: [schema.produtoVariante.filialId, schema.produtoVariante.codigoExterno],
    set: {
      codigoProdutoExterno: row.codigoProdutoExterno,
      codigoProdutoTamanhoExterno: row.codigoProdutoTamanhoExterno,
      precoCusto: row.precoCusto,
      precoVenda: row.precoVenda,
      estoqueAtual: row.estoqueAtual,
      estoqueMinimo: row.estoqueMinimo,
      estoqueControlado: row.estoqueControlado,
      codigoBarra: row.codigoBarra,
      desktop: row.desktop,
      comandaMobile: row.comandaMobile,
      cardapioDigital: row.cardapioDigital,
      menuDino: row.menuDino,
      totem: row.totem,
      dataPausado: row.dataPausado,
      dataDelete: row.dataDelete,
      versaoReg: row.versaoReg,
      sincronizadoEm: row.sincronizadoEm,
    },
  });

  // Resolve FK produto_id e produto_tamanho_id
  await db.execute(drizzleSql`
    UPDATE produto_variante pv SET produto_id = p.id
    FROM produto p
    WHERE pv.filial_id = ${filialId} AND pv.codigo_externo = ${codigoExterno}
      AND pv.codigo_produto_externo = p.codigo_externo AND p.filial_id = ${filialId}
      AND pv.produto_id IS NULL
  `);
  if (row.codigoProdutoTamanhoExterno) {
    await db.execute(drizzleSql`
      UPDATE produto_variante pv SET produto_tamanho_id = pt.id
      FROM produto_tamanho pt
      WHERE pv.filial_id = ${filialId} AND pv.codigo_externo = ${codigoExterno}
        AND pv.codigo_produto_tamanho_externo = pt.codigo_externo AND pt.filial_id = ${filialId}
        AND pv.produto_tamanho_id IS NULL
    `);
  }
  return { status: 'ok' };
}

// ---------- PRODUTOFICHA ----------

async function mapProdutoFicha(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    await db.delete(schema.produtoVarianteFicha).where(and(
      eq(schema.produtoVarianteFicha.filialId, filialId),
      eq(schema.produtoVarianteFicha.codigoExterno, codigoExterno),
    ));
    return { status: 'ok' };
  }

  const codigoVarianteExterno = num(d.CODIGOPRODUTODETALHE);
  const codigoIngredienteExterno = num(d.CODIGOPRODUTODETALHEITEM);
  if (!codigoVarianteExterno || !codigoIngredienteExterno) return { status: 'erro', msg: 'variantes nulas' };

  const row = {
    filialId,
    codigoExterno,
    codigoVarianteExterno,
    codigoIngredienteExterno,
    quantidade: numStr(d.QUANTIDADE),
    precoPromo: numStr(d.PRECOPROMO),
    sincronizadoEm: new Date(),
  };

  await db.insert(schema.produtoVarianteFicha).values(row).onConflictDoUpdate({
    target: [schema.produtoVarianteFicha.filialId, schema.produtoVarianteFicha.codigoExterno],
    set: {
      codigoVarianteExterno: row.codigoVarianteExterno,
      codigoIngredienteExterno: row.codigoIngredienteExterno,
      quantidade: row.quantidade,
      precoPromo: row.precoPromo,
      sincronizadoEm: row.sincronizadoEm,
    },
  });

  // Resolve FKs variante_id e ingrediente_id
  await db.execute(drizzleSql`
    UPDATE produto_variante_ficha pvf SET variante_id = pv.id
    FROM produto_variante pv
    WHERE pvf.filial_id = ${filialId} AND pvf.codigo_externo = ${codigoExterno}
      AND pvf.codigo_variante_externo = pv.codigo_externo AND pv.filial_id = ${filialId}
      AND pvf.variante_id IS NULL
  `);
  await db.execute(drizzleSql`
    UPDATE produto_variante_ficha pvf SET ingrediente_id = pv.id
    FROM produto_variante pv
    WHERE pvf.filial_id = ${filialId} AND pvf.codigo_externo = ${codigoExterno}
      AND pvf.codigo_ingrediente_externo = pv.codigo_externo AND pv.filial_id = ${filialId}
      AND pvf.ingrediente_id IS NULL
  `);
  return { status: 'ok' };
}

// ---------- PRODUTODETALHECOMPLEMENTO ----------

async function mapProdutoDetalheComplemento(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    await db.delete(schema.produtoVarianteComplemento).where(and(
      eq(schema.produtoVarianteComplemento.filialId, filialId),
      eq(schema.produtoVarianteComplemento.codigoExterno, codigoExterno),
    ));
    return { status: 'ok' };
  }

  const codigoVarianteExterno = num(d.CODIGOPRODUTODETALHE);
  const codigoComplementoExterno = num(d.CODIGOPRODUTODETALHECOMPLEMENTO);
  if (!codigoVarianteExterno || !codigoComplementoExterno) return { status: 'erro', msg: 'variantes nulas' };

  const row = {
    filialId,
    codigoExterno,
    codigoVarianteExterno,
    codigoComplementoExterno,
    codigoGuid: str(d.CODIGOGUID),
    sincronizadoEm: new Date(),
  };

  await db.insert(schema.produtoVarianteComplemento).values(row).onConflictDoUpdate({
    target: [schema.produtoVarianteComplemento.filialId, schema.produtoVarianteComplemento.codigoExterno],
    set: {
      codigoVarianteExterno: row.codigoVarianteExterno,
      codigoComplementoExterno: row.codigoComplementoExterno,
      codigoGuid: row.codigoGuid,
      sincronizadoEm: row.sincronizadoEm,
    },
  });

  await db.execute(drizzleSql`
    UPDATE produto_variante_complemento pvc SET variante_id = pv.id
    FROM produto_variante pv
    WHERE pvc.filial_id = ${filialId} AND pvc.codigo_externo = ${codigoExterno}
      AND pvc.codigo_variante_externo = pv.codigo_externo AND pv.filial_id = ${filialId}
      AND pvc.variante_id IS NULL
  `);
  await db.execute(drizzleSql`
    UPDATE produto_variante_complemento pvc SET complemento_id = pv.id
    FROM produto_variante pv
    WHERE pvc.filial_id = ${filialId} AND pvc.codigo_externo = ${codigoExterno}
      AND pvc.codigo_complemento_externo = pv.codigo_externo AND pv.filial_id = ${filialId}
      AND pvc.complemento_id IS NULL
  `);
  return { status: 'ok' };
}

// ---------- Lookups globais simples (PK = codigo, sem filial) ----------

/** Helper: lookup global com codigo numeric. Padrao: {codigo, descricao|nome|sigla|tipo|ordem|codigoDescricao|codigoFiscal} */
type LookupKV = Record<string, unknown>;

async function lookupSimples(
  tabela: keyof typeof schema,
  codCol: string,
  op: Operacao,
  chave: string,
  d: Dados,
  campos: (k: string, d: Dados) => LookupKV,
): Promise<ResultadoMap> {
  const codigo = parseInt(chave, 10);
  if (!Number.isFinite(codigo)) return { status: 'erro', msg: 'codigo invalido' };
  const tabelaObj = (schema as Record<string, unknown>)[tabela as string];
  if (op === 'D') {
    await db.delete(tabelaObj as never).where(eq((tabelaObj as never as Record<string, unknown>)[codCol] as never, codigo));
    return { status: 'ok' };
  }
  const valores = { [codCol]: codigo, ...campos(chave, d) };
  await db.insert(tabelaObj as never).values(valores as never).onConflictDoUpdate({
    target: (tabelaObj as never as Record<string, unknown>)[codCol] as never,
    set: campos(chave, d) as never,
  });
  return { status: 'ok' };
}

const mapItemPedidoTipo = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('itemPedidoTipo', 'codigo', op, c, d, (_k, d) => ({ descricao: str(d.DESCRICAO), nome: str(d.NOME) }));
const mapPedidoOrigem = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('pedidoOrigem', 'codigo', op, c, d, (_k, d) => ({ descricao: str(d.DESCRICAO), nome: str(d.NOME) }));
const mapMeioPagamento = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('meioPagamento', 'codigo', op, c, d, (_k, d) => ({ descricao: str(d.DESCRICAO), nome: str(d.NOME) }));
const mapGrupoDre = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('grupoDre', 'codigo', op, c, d, (_k, d) => ({ ordem: num(d.ORDEM), descricao: str(d.DESCRICAO) }));
const mapTipoEntrega = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('tipoEntrega', 'codigo', op, c, d, (_k, d) => ({ descricao: str(d.DESCRICAO), nome: str(d.NOME) }));
const mapNfTipo = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('nfTipo', 'codigo', op, c, d, (_k, d) => ({ descricao: str(d.DESCRICAO), nome: str(d.NOME) }));
const mapRegimeTributario = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('regimeTributario', 'codigo', op, c, d, (_k, d) => ({ descricao: str(d.DESCRICAO), nome: str(d.NOME) }));
const mapModalidadeBcIcms = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('modalidadeBcIcms', 'codigo', op, c, d, (_k, d) => ({ descricao: str(d.DESCRICAO), nome: str(d.NOME) }));
const mapOrigemMercadoria = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('origemMercadoria', 'codigo', op, c, d, (_k, d) => ({ descricao: str(d.DESCRICAO), nome: str(d.NOME) }));
const mapTipoDocumentoDestinatario = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('tipoDocumentoDestinatario', 'codigo', op, c, d, (_k, d) => ({ descricao: str(d.DESCRICAO), nome: str(d.NOME) }));
const mapCfop = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('cfop', 'codigo', op, c, d, (_k, d) => ({ descricao: str(d.DESCRICAO), codigoDescricao: str(d.CODIGODESCRICAO) }));

// Lookups com PK varchar (CST/CSOSN)
async function mapCst(
  tabela: 'situacaoTributaria' | 'situacaoTributariaPis' | 'situacaoTributariaCofins',
  op: Operacao, chave: string, d: Dados,
): Promise<ResultadoMap> {
  const codigo = String(chave).trim();
  if (!codigo) return { status: 'erro', msg: 'codigo invalido' };
  const tabelaObj = schema[tabela];
  if (op === 'D') {
    await db.delete(tabelaObj).where(eq(tabelaObj.codigo, codigo));
    return { status: 'ok' };
  }
  const row = {
    codigo,
    tipo: str(d.TIPO),
    descricao: str(d.DESCRICAO),
    codigoDescricao: str(d.CODIGODESCRICAO),
  };
  await db.insert(tabelaObj).values(row).onConflictDoUpdate({
    target: tabelaObj.codigo,
    set: { tipo: row.tipo, descricao: row.descricao, codigoDescricao: row.codigoDescricao },
  });
  return { status: 'ok' };
}
const mapSituacaoTributaria = (_f: string, op: Operacao, c: string, d: Dados) => mapCst('situacaoTributaria', op, c, d);
const mapSituacaoTributariaPis = (_f: string, op: Operacao, c: string, d: Dados) => mapCst('situacaoTributariaPis', op, c, d);
const mapSituacaoTributariaCofins = (_f: string, op: Operacao, c: string, d: Dados) => mapCst('situacaoTributariaCofins', op, c, d);

const mapFormaPagamentoConsumer = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('formaPagamentoConsumer', 'codigo', op, c, d, (_k, d) => ({
    descricao: str(d.DESCRICAO),
    codigoMeioPagamento: num(d.CODIGOMEIOPAGAMENTO),
    codigoCredenciadoraCartao: num(d.CODIGOCREDENCIADORACARTAO),
    ativo: bool(d.ATIVO),
  }));

const mapCredenciadoraCartao = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('credenciadoraCartao', 'codigo', op, c, d, (_k, d) => ({
    nome: str(d.NOME),
    codigoFiscal: num(d.CODIGOFISCAL),
  }));

const mapOperadoraCartao = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('operadoraCartao', 'codigo', op, c, d, (_k, d) => ({
    nome: str(d.NOME),
    codigoFiscal: num(d.CODIGOFISCAL),
  }));

const mapTefAdquirente = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('tefAdquirente', 'codigo', op, c, d, (_k, d) => ({
    nome: str(d.NOME),
    codCredenciadoraCartao: num(d.CODCREDENCIADORACARTAO),
  }));

const mapNfSerie = (_f: string, op: Operacao, c: string, d: Dados) =>
  lookupSimples('nfSerie', 'codigo', op, c, d, (_k, d) => ({
    serie: num(d.SERIE),
    descricao: str(d.DESCRICAO),
    ultimoNumero: num(d.ULTIMONUMERO),
  }));

// ---------- CAIXA ----------

async function mapCaixa(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };
  if (op === 'D') return { status: 'ok', msg: 'delete skipped' };

  const row = {
    filialId, codigoExterno,
    codigoUsuario: num(d.CODIGOUSUARIO),
    dataAbertura: date(d.DATAABERTURA),
    dataFechamento: date(d.DATAFECHAMENTO),
    saldoInicial: numStr(d.SALDOINICIAL),
    saldoFinal: numStr(d.SALDOFINAL),
    saldoFinalInformado: numStr(d.SALDOFINALINFORMADO),
    observacao: str(d.OBSERVACAO),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };
  await db.insert(schema.caixa).values(row).onConflictDoUpdate({
    target: [schema.caixa.filialId, schema.caixa.codigoExterno],
    set: {
      codigoUsuario: row.codigoUsuario, dataAbertura: row.dataAbertura,
      dataFechamento: row.dataFechamento, saldoInicial: row.saldoInicial,
      saldoFinal: row.saldoFinal, saldoFinalInformado: row.saldoFinalInformado,
      observacao: row.observacao, versaoReg: row.versaoReg, sincronizadoEm: row.sincronizadoEm,
    },
  });
  return { status: 'ok' };
}

async function mapCaixaOperacao(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };
  if (op === 'D') {
    await db.update(schema.caixaOperacao).set({ dataDelete: new Date() })
      .where(and(eq(schema.caixaOperacao.filialId, filialId), eq(schema.caixaOperacao.codigoExterno, codigoExterno)));
    return { status: 'ok' };
  }
  const row = {
    filialId, codigoExterno,
    codigoCaixa: num(d.CODIGOCAIXA),
    codigoFormaPagamento: num(d.CODIGOFORMAPAGAMENTO),
    codigoContasPagar: num(d.CODIGOCONTASPAGAR),
    dataOperacao: date(d.DATAOPERACAO),
    valorEntrada: numStr(d.VALORENTRADA),
    valorSaida: numStr(d.VALORSAIDA),
    tipo: str(d.TIPO)?.slice(0, 1),
    observacao: str(d.OBSERVACAO),
    dataDelete: date(d.DATADELETE),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };
  await db.insert(schema.caixaOperacao).values(row).onConflictDoUpdate({
    target: [schema.caixaOperacao.filialId, schema.caixaOperacao.codigoExterno],
    set: {
      codigoCaixa: row.codigoCaixa, codigoFormaPagamento: row.codigoFormaPagamento,
      codigoContasPagar: row.codigoContasPagar, dataOperacao: row.dataOperacao,
      valorEntrada: row.valorEntrada, valorSaida: row.valorSaida,
      tipo: row.tipo, observacao: row.observacao, dataDelete: row.dataDelete,
      versaoReg: row.versaoReg, sincronizadoEm: row.sincronizadoEm,
    },
  });
  await db.execute(drizzleSql`
    UPDATE caixa_operacao co SET caixa_id = c.id
    FROM caixa c
    WHERE co.filial_id = ${filialId} AND co.codigo_externo = ${codigoExterno}
      AND co.codigo_caixa = c.codigo_externo AND c.filial_id = ${filialId}
      AND co.caixa_id IS NULL
  `);
  return { status: 'ok' };
}

// ---------- ESTOQUE Consumer ----------

async function mapConsumerEstoque(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };
  if (op === 'D') return { status: 'ok', msg: 'delete skipped' };
  const row = {
    filialId, codigoExterno,
    codigoProdutoExterno: num(d.CODIGOPRODUTO),
    dataCadastro: date(d.DATACADASTRO),
    sincronizadoEm: new Date(),
  };
  await db.insert(schema.consumerEstoque).values(row).onConflictDoUpdate({
    target: [schema.consumerEstoque.filialId, schema.consumerEstoque.codigoExterno],
    set: { codigoProdutoExterno: row.codigoProdutoExterno, dataCadastro: row.dataCadastro, sincronizadoEm: row.sincronizadoEm },
  });
  await db.execute(drizzleSql`
    UPDATE consumer_estoque ce SET produto_id = p.id FROM produto p
    WHERE ce.filial_id = ${filialId} AND ce.codigo_externo = ${codigoExterno}
      AND ce.codigo_produto_externo = p.codigo_externo AND p.filial_id = ${filialId}
      AND ce.produto_id IS NULL
  `);
  return { status: 'ok' };
}

async function mapEstoqueMovimentacao(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };
  if (op === 'D') {
    await db.update(schema.consumerEstoqueMovimentacao).set({ dataDelete: new Date() })
      .where(and(eq(schema.consumerEstoqueMovimentacao.filialId, filialId), eq(schema.consumerEstoqueMovimentacao.codigoExterno, codigoExterno)));
    return { status: 'ok' };
  }
  const row = {
    filialId, codigoExterno,
    codigoProdutoDetalhe: num(d.CODIGOPRODUTODETALHE),
    codigoItemPedido: num(d.CODIGOITEMPEDIDO),
    codigoUsuario: num(d.CODIGOUSUARIO),
    qtdInicial: numStr(d.QTDINICIAL),
    qtd: numStr(d.QTD),
    qtdFinal: numStr(d.QTDFINAL),
    valorCompra: numStr(d.VALORCOMPRA),
    tipo: str(d.TIPO)?.slice(0, 1),
    observacao: str(d.OBSERVACAO),
    codigoMovimentacaoEstorno: num(d.CODIGOMOVIMENTACAOESTORNO),
    dataInsert: date(d.DATAINSERT),
    dataUpdate: date(d.DATAUPDATE),
    dataDelete: date(d.DATADELETE),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };
  await db.insert(schema.consumerEstoqueMovimentacao).values(row).onConflictDoUpdate({
    target: [schema.consumerEstoqueMovimentacao.filialId, schema.consumerEstoqueMovimentacao.codigoExterno],
    set: { ...row, filialId: undefined, codigoExterno: undefined } as never,
  });
  return { status: 'ok' };
}

// ---------- DELIVERY ----------

async function mapTaxaEntrega(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };
  if (op === 'D') return { status: 'ok', msg: 'delete skipped' };
  const row = {
    filialId, codigoExterno,
    descricao: str(d.DESCRICAO),
    valor: numStr(d.VALOR),
    tempoMinutos: num(d.TEMPOMINUTOS),
    pausaTemporariaInicio: date(d.PAUSATEMPORARIAINICIO),
    pausaTemporariaFim: date(d.PAUSATEMPORARIAFIM),
    sincronizadoEm: new Date(),
  };
  await db.insert(schema.taxaEntrega).values(row).onConflictDoUpdate({
    target: [schema.taxaEntrega.filialId, schema.taxaEntrega.codigoExterno],
    set: { descricao: row.descricao, valor: row.valor, tempoMinutos: row.tempoMinutos,
           pausaTemporariaInicio: row.pausaTemporariaInicio, pausaTemporariaFim: row.pausaTemporariaFim,
           sincronizadoEm: row.sincronizadoEm },
  });
  return { status: 'ok' };
}

async function mapTaxaEntregaCep(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };
  if (op === 'D') return { status: 'ok', msg: 'delete skipped' };
  const row = {
    filialId, codigoExterno,
    codigoTaxaEntrega: num(d.CODIGOTAXAENTREGA),
    cepInicial: str(d.CEPINICIAL),
    cepFinal: str(d.CEPFINAL),
    sincronizadoEm: new Date(),
  };
  await db.insert(schema.taxaEntregaCep).values(row).onConflictDoUpdate({
    target: [schema.taxaEntregaCep.filialId, schema.taxaEntregaCep.codigoExterno],
    set: { codigoTaxaEntrega: row.codigoTaxaEntrega, cepInicial: row.cepInicial, cepFinal: row.cepFinal, sincronizadoEm: row.sincronizadoEm },
  });
  await db.execute(drizzleSql`
    UPDATE taxa_entrega_cep tec SET taxa_entrega_id = te.id FROM taxa_entrega te
    WHERE tec.filial_id = ${filialId} AND tec.codigo_externo = ${codigoExterno}
      AND tec.codigo_taxa_entrega = te.codigo_externo AND te.filial_id = ${filialId}
      AND tec.taxa_entrega_id IS NULL
  `);
  return { status: 'ok' };
}

async function mapGrupoEntrega(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };
  if (op === 'D') return { status: 'ok', msg: 'delete skipped' };
  const row = { filialId, codigoExterno, descricao: str(d.DESCRICAO), sincronizadoEm: new Date() };
  await db.insert(schema.grupoEntrega).values(row).onConflictDoUpdate({
    target: [schema.grupoEntrega.filialId, schema.grupoEntrega.codigoExterno],
    set: { descricao: row.descricao, sincronizadoEm: row.sincronizadoEm },
  });
  return { status: 'ok' };
}

async function mapEndereco(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };
  if (op === 'D') {
    await db.update(schema.endereco).set({ dataDelete: new Date() })
      .where(and(eq(schema.endereco.filialId, filialId), eq(schema.endereco.codigoExterno, codigoExterno)));
    return { status: 'ok' };
  }
  const row = {
    filialId, codigoExterno,
    codigoContato: num(d.CODIGOCONTATO),
    codigoTaxaEntrega: num(d.CODIGOTAXAENTREGA),
    principal: bool(d.PRINCIPAL),
    lat: numStr(d.LAT), lon: numStr(d.LON),
    cep: str(d.CEP), logradouro: str(d.LOGRADOURO), numero: str(d.NUMERO),
    complemento: str(d.COMPLEMENTO), bairro: str(d.BAIRRO), cidade: str(d.CIDADE),
    uf: str(d.UF)?.slice(0, 2),
    descricao: str(d.DESCRICAO), referencia: str(d.REFERENCIA),
    dataDelete: date(d.DATADELETE), sincronizadoEm: new Date(),
  };
  await db.insert(schema.endereco).values(row).onConflictDoUpdate({
    target: [schema.endereco.filialId, schema.endereco.codigoExterno],
    set: { ...row, filialId: undefined, codigoExterno: undefined } as never,
  });
  return { status: 'ok' };
}

async function mapDelivery(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  // PK = CODIGOPEDIDO
  const codigoPedidoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoPedidoExterno)) return { status: 'erro', msg: 'chave invalida' };
  if (op === 'D') return { status: 'ok', msg: 'delete skipped' };
  const row = {
    filialId, codigoPedidoExterno,
    codigoContato: num(d.CODIGOCONTATO),
    codigoEndereco: num(d.CODIGOENDERECO),
    codigoTaxaEntrega: num(d.CODIGOTAXAENTREGA),
    codigoTipoEntrega: num(d.CODIGOTIPOENTREGA),
    preparoPrevistoEm: date(d.PREPAROPREVISTOEM),
    preparoIniciadoEm: date(d.PREPAROINICIADOEM),
    saiuEntregaEm: date(d.SAIUENTREGAEM),
    entregaPrevistaEm: date(d.ENTREGAPREVISTAEM),
    entregueEm: date(d.ENTREGUEEM),
    retiradaPrevistaEm: date(d.RETIRADAPREVISTAEM),
    retiradoEm: date(d.RETIRADOEM),
    prontoParaRetiradaEm: date(d.PRONTOPARARETIRADAEM),
    sincronizadoEm: new Date(),
  };
  await db.insert(schema.delivery).values(row).onConflictDoUpdate({
    target: [schema.delivery.filialId, schema.delivery.codigoPedidoExterno],
    set: { ...row, filialId: undefined, codigoPedidoExterno: undefined } as never,
  });
  // Resolve FKs pedido_id e endereco_id
  await db.execute(drizzleSql`
    UPDATE delivery d SET pedido_id = p.id FROM pedido p
    WHERE d.filial_id = ${filialId} AND d.codigo_pedido_externo = ${codigoPedidoExterno}
      AND d.codigo_pedido_externo = p.codigo_externo AND p.filial_id = ${filialId}
      AND d.pedido_id IS NULL
  `);
  return { status: 'ok' };
}

async function mapPedidoGrupoEntrega(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoPedidoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoPedidoExterno)) return { status: 'erro', msg: 'chave invalida' };
  if (op === 'D') return { status: 'ok', msg: 'delete skipped' };
  const row = {
    filialId, codigoPedidoExterno,
    codigoGrupoEntrega: num(d.CODIGOGRUPOENTREGA),
    sincronizadoEm: new Date(),
  };
  await db.insert(schema.pedidoGrupoEntrega).values(row).onConflictDoUpdate({
    target: [schema.pedidoGrupoEntrega.filialId, schema.pedidoGrupoEntrega.codigoPedidoExterno],
    set: { codigoGrupoEntrega: row.codigoGrupoEntrega, sincronizadoEm: row.sincronizadoEm },
  });
  return { status: 'ok' };
}

// ---------- ITEMPEDIDOFICHA ----------

async function mapItemPedidoFicha(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };
  if (op === 'D') {
    await db.update(schema.pedidoItemFicha).set({ dataDelete: new Date() })
      .where(and(eq(schema.pedidoItemFicha.filialId, filialId), eq(schema.pedidoItemFicha.codigoExterno, codigoExterno)));
    return { status: 'ok' };
  }
  const row = {
    filialId, codigoExterno,
    codigoItemPedido: num(d.CODIGOITEMPEDIDO),
    codigoProdutoDetalhe: num(d.CODIGOPRODUTODETALHE),
    codigoColaborador: num(d.CODIGOCOLABORADOR),
    dataInsert: date(d.DATAINSERT), dataUpdate: date(d.DATAUPDATE), dataDelete: date(d.DATADELETE),
    sincronizadoEm: new Date(),
  };
  await db.insert(schema.pedidoItemFicha).values(row).onConflictDoUpdate({
    target: [schema.pedidoItemFicha.filialId, schema.pedidoItemFicha.codigoExterno],
    set: { ...row, filialId: undefined, codigoExterno: undefined } as never,
  });
  return { status: 'ok' };
}

// ---------- iFood / MenuDino / OrderIntegration ----------

async function mapIfoodPedido(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoPedidoIfood = String(chave);
  if (!codigoPedidoIfood) return { status: 'erro', msg: 'chave invalida' };
  if (op === 'D') return { status: 'ok', msg: 'delete skipped' };
  const row = {
    filialId, codigoPedidoIfood,
    codigoPedidoConsumer: num(d.CODIGOPEDIDOCONSUMER),
    status: str(d.STATUS), statusItens: str(d.STATUSITENS),
    cancelamentoStatus: str(d.CANCELAMENTOSTATUS),
    observacoes: str(d.OBSERVACOES),
    payloadJson: d.JSON ? String(d.JSON).slice(0, 100000) : null,
    dataInsert: date(d.DATAINSERT), dataUpdate: date(d.DATAUPDATE), dataDelete: date(d.DATADELETE),
    sincronizadoEm: new Date(),
  };
  await db.insert(schema.ifoodPedido).values(row).onConflictDoUpdate({
    target: [schema.ifoodPedido.filialId, schema.ifoodPedido.codigoPedidoIfood],
    set: { ...row, filialId: undefined, codigoPedidoIfood: undefined } as never,
  });
  return { status: 'ok' };
}

async function mapMenudinoPedido(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  if (!/^-?\d+$/.test(chave)) return { status: 'erro', msg: 'chave invalida' };
  if (op === 'D') return { status: 'ok', msg: 'delete skipped' };
  const row = {
    filialId,
    codigoPedidoMenudino: BigInt(chave),
    codigoPedidoConsumer: num(d.CODIGOPEDIDOCONSUMER),
    guidPedidoMenudino: str(d.GUIDPEDIDOMENUDINO),
    status: str(d.STATUS), statusItens: str(d.STATUSITENS),
    observacoes: str(d.OBSERVACOES),
    payloadJson: d.JSON ? String(d.JSON).slice(0, 100000) : null,
    dataInsert: date(d.DATAINSERT), dataUpdate: date(d.DATAUPDATE), dataDelete: date(d.DATADELETE),
    sincronizadoEm: new Date(),
  };
  await db.insert(schema.menudinoPedido).values(row).onConflictDoUpdate({
    target: [schema.menudinoPedido.filialId, schema.menudinoPedido.codigoPedidoMenudino],
    set: { ...row, filialId: undefined, codigoPedidoMenudino: undefined } as never,
  });
  return { status: 'ok' };
}

async function mapOrderIntegration(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const integrationId = parseInt(chave, 10);
  if (!Number.isFinite(integrationId)) return { status: 'erro', msg: 'id invalido' };
  if (op === 'D') return { status: 'ok', msg: 'delete skipped' };
  const row = {
    filialId, integrationId,
    externalId: str(d.EXTERNALID),
    providerOrigin: num(d.PROVIDERORIGIN),
    localOrderId: num(d.LOCALORDERID),
    insertedAt: date(d.INSERTEDAT), updatedAt: date(d.UPDATEDAT), deletedAt: date(d.DELETEDAT),
    sincronizadoEm: new Date(),
  };
  await db.insert(schema.orderIntegration).values(row).onConflictDoUpdate({
    target: [schema.orderIntegration.filialId, schema.orderIntegration.integrationId],
    set: { ...row, filialId: undefined, integrationId: undefined } as never,
  });
  return { status: 'ok' };
}

async function mapOrderShipping(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const shippingId = parseInt(chave, 10);
  if (!Number.isFinite(shippingId)) return { status: 'erro', msg: 'id invalido' };
  if (op === 'D') return { status: 'ok', msg: 'delete skipped' };
  const row = {
    filialId, shippingId,
    orderIntegrationId: num(d.ORDERINTEGRATIONID),
    localOrderId: num(d.LOCALORDERID),
    externalId: str(d.EXTERNALID),
    providerOrigin: num(d.PROVIDERORIGIN),
    trackingUrl: str(d.TRACKINGURL),
    method: str(d.METHOD), brand: str(d.BRAND),
    value: numStr(d.VALUE),
    insertedAt: date(d.INSERTEDAT), updatedAt: date(d.UPDATEDAT), deletedAt: date(d.DELETEDAT),
    sincronizadoEm: new Date(),
  };
  await db.insert(schema.orderShipping).values(row).onConflictDoUpdate({
    target: [schema.orderShipping.filialId, schema.orderShipping.shippingId],
    set: { ...row, filialId: undefined, shippingId: undefined } as never,
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
  NFE: mapNfe,
  NFCE: mapNfce,
  NFITEM: mapNfItem,
  NFPAGAMENTO: mapNfPagamento,
  PRODUTOTIPO: mapProdutoTipo,
  UNIDADECOMERCIALIZACAO: mapUnidadeComercializacao,
  PRODUTOSTAMANHOS: mapProdutoTamanhoLookup,
  PRODUTOTAMANHO: mapProdutoTamanho,
  PRODUTODETALHE: mapProdutoDetalhe,
  PRODUTOFICHA: mapProdutoFicha,
  PRODUTODETALHECOMPLEMENTO: mapProdutoDetalheComplemento,
  // Lookups globais
  ITEMPEDIDOTIPO: mapItemPedidoTipo,
  PEDIDOORIGEM: mapPedidoOrigem,
  MEIOPAGAMENTO: mapMeioPagamento,
  GRUPODRE: mapGrupoDre,
  TIPOENTREGA: mapTipoEntrega,
  NFTIPO: mapNfTipo,
  REGIMETRIBUTARIO: mapRegimeTributario,
  MODALIDADEBCICMS: mapModalidadeBcIcms,
  ORIGEMMERCADORIA: mapOrigemMercadoria,
  TIPODOCUMENTODESTINATARIO: mapTipoDocumentoDestinatario,
  CFOP: mapCfop,
  SITUACAOTRIBUTARIA: mapSituacaoTributaria,
  SITUACAOTRIBUTARIAPIS: mapSituacaoTributariaPis,
  SITUACAOTRIBUTARIACOFINS: mapSituacaoTributariaCofins,
  FORMASPAGAMENTO: mapFormaPagamentoConsumer,
  CREDENCIADORACARTAO: mapCredenciadoraCartao,
  OPERADORACARTAO: mapOperadoraCartao,
  TEFADQUIRENTE: mapTefAdquirente,
  NFSERIE: mapNfSerie,
  // Operacional
  CAIXA: mapCaixa,
  CAIXAOPERACAO: mapCaixaOperacao,
  ESTOQUE: mapConsumerEstoque,
  ESTOQUEMOVIMENTACAO: mapEstoqueMovimentacao,
  TAXAENTREGA: mapTaxaEntrega,
  TAXAENTREGACEP: mapTaxaEntregaCep,
  GRUPOENTREGA: mapGrupoEntrega,
  ENDERECO: mapEndereco,
  DELIVERY: mapDelivery,
  PEDIDOGRUPOENTREGA: mapPedidoGrupoEntrega,
  ITEMPEDIDOFICHA: mapItemPedidoFicha,
  // Integracao externa
  IFOODPEDIDO: mapIfoodPedido,
  MENUDINOPEDIDO: mapMenudinoPedido,
  ORDERINTEGRATION: mapOrderIntegration,
  ORDERSHIPPING: mapOrderShipping,
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
