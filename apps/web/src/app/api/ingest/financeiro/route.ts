// POST /api/ingest/financeiro
// Endpoint chamado pelo agente local pra enviar entidades financeiras
// do Consumer: fornecedores, categorias, contas bancarias, contas a pagar.
//
// Auth: Bearer <agente_token>
// Body: { fornecedores?, categorias?, contasBancarias?, contasPagar? }
// Cada campo e' opcional — o agente envia o que tiver novo.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, sql as drizzleSql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FornecedorSchema = z.object({
  codigoExterno: z.number().int(),
  cnpjOuCpf: z.string().nullable(),
  nome: z.string().nullable(),
  razaoSocial: z.string().nullable(),
  endereco: z.string().nullable(),
  numero: z.string().nullable(),
  complemento: z.string().nullable(),
  bairro: z.string().nullable(),
  cidade: z.string().nullable(),
  uf: z.string().nullable(),
  cep: z.string().nullable(),
  email: z.string().nullable(),
  fonePrincipal: z.string().nullable(),
  foneSecundario: z.string().nullable(),
  rgOuIe: z.string().nullable(),
  dataDelete: z.string().nullable(),
  versaoReg: z.number().int().nullable(),
});

const CategoriaSchema = z.object({
  codigoExterno: z.number().int(),
  codigoPaiExterno: z.number().int().nullable(),
  codigoGrupoDreExterno: z.number().int().nullable(),
  descricao: z.string().nullable(),
  tipo: z.string().nullable(),
  excluidaEm: z.string().nullable(),
  versaoReg: z.number().int().nullable(),
});

const ContaBancariaSchema = z.object({
  codigoExterno: z.number().int(),
  descricao: z.string().nullable(),
  banco: z.string().nullable(),
  agencia: z.string().nullable(),
  conta: z.string().nullable(),
  dataDelete: z.string().nullable(),
  versaoReg: z.number().int().nullable(),
});

const ContaPagarSchema = z.object({
  codigoExterno: z.number().int(),
  codigoFornecedorExterno: z.number().int().nullable(),
  codigoCategoriaExterno: z.number().int().nullable(),
  codigoContaBancariaExterno: z.number().int().nullable(),
  parcela: z.number().int().nullable(),
  totalParcelas: z.number().int().nullable(),
  dataVencimento: z.string(),
  valor: z.number(),
  dataPagamento: z.string().nullable(),
  descontos: z.number().nullable(),
  jurosMulta: z.number().nullable(),
  valorPago: z.number().nullable(),
  codigoReferencia: z.string().nullable(),
  competencia: z.string().nullable(),
  descricao: z.string().nullable(),
  observacao: z.string().nullable(),
  dataCadastro: z.string().nullable(),
  dataDelete: z.string().nullable(),
  versaoReg: z.number().int().nullable(),
});

const ClienteSchema = z.object({
  codigoExterno: z.number().int(),
  cpfOuCnpj: z.string().nullable(),
  nome: z.string().nullable(),
  email: z.string().nullable(),
  telefone: z.string().nullable(),
  dataDelete: z.string().nullable(),
  versaoReg: z.number().int().nullable(),
});

const MovimentoContaCorrenteSchema = z.object({
  codigoExterno: z.number().int(),
  codigoClienteExterno: z.number().int().nullable(),
  codigoPedidoExterno: z.number().int().nullable(),
  dataHora: z.string().nullable(),
  saldoInicial: z.number().nullable(),
  credito: z.number().nullable(),
  debito: z.number().nullable(),
  saldoFinal: z.number().nullable(),
  codigoPagamento: z.number().int().nullable(),
  codigoUsuario: z.number().int().nullable(),
  codigoContaEstornada: z.number().int().nullable(),
  observacao: z.string().nullable(),
  importado: z.string().nullable(),
  versaoReg: z.number().int().nullable(),
});

const BodySchema = z.object({
  fornecedores: z.array(FornecedorSchema).max(2000).optional(),
  categorias: z.array(CategoriaSchema).max(2000).optional(),
  contasBancarias: z.array(ContaBancariaSchema).max(2000).optional(),
  contasPagar: z.array(ContaPagarSchema).max(2000).optional(),
  clientes: z.array(ClienteSchema).max(2000).optional(),
  movimentosContaCorrente: z.array(MovimentoContaCorrenteSchema).max(2000).optional(),
});

const CHUNK_SIZE = 500;

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = auth.slice(7);
  if (!token.startsWith('agt_')) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 });
  }

  const [filial] = await db
    .select({ id: schema.filial.id })
    .from(schema.filial)
    .where(eq(schema.filial.agenteToken, token))
    .limit(1);
  if (!filial) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // heartbeat
  await db
    .update(schema.filial)
    .set({ ultimoPing: new Date() })
    .where(eq(schema.filial.id, filial.id));

  const {
    fornecedores,
    categorias,
    contasBancarias,
    contasPagar,
    clientes,
    movimentosContaCorrente,
  } = parsed.data;
  let fornecedoresRecebidos = 0;
  let categoriasRecebidas = 0;
  let contasBancariasRecebidas = 0;
  let contasPagarRecebidas = 0;
  let clientesRecebidos = 0;
  let movimentosRecebidos = 0;

  // --- Fornecedores ---
  if (fornecedores?.length) {
    const rows = fornecedores.map((f) => ({
      filialId: filial.id,
      codigoExterno: f.codigoExterno,
      cnpjOuCpf: f.cnpjOuCpf?.replace(/\D/g, '').slice(0, 14) || null,
      nome: f.nome,
      razaoSocial: f.razaoSocial,
      endereco: f.endereco,
      numero: f.numero,
      complemento: f.complemento,
      bairro: f.bairro,
      cidade: f.cidade,
      uf: f.uf?.slice(0, 2) || null,
      cep: f.cep?.replace(/\D/g, '').slice(0, 10) || null,
      email: f.email,
      fonePrincipal: f.fonePrincipal,
      foneSecundario: f.foneSecundario,
      rgOuIe: f.rgOuIe,
      dataDelete: f.dataDelete ? new Date(f.dataDelete) : null,
      versaoReg: f.versaoReg,
      sincronizadoEm: new Date(),
    }));
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await db
        .insert(schema.fornecedor)
        .values(rows.slice(i, i + CHUNK_SIZE))
        .onConflictDoUpdate({
          target: [schema.fornecedor.filialId, schema.fornecedor.codigoExterno],
          set: {
            cnpjOuCpf: drizzleSql`excluded.cnpj_ou_cpf`,
            nome: drizzleSql`excluded.nome`,
            razaoSocial: drizzleSql`excluded.razao_social`,
            endereco: drizzleSql`excluded.endereco`,
            numero: drizzleSql`excluded.numero`,
            complemento: drizzleSql`excluded.complemento`,
            bairro: drizzleSql`excluded.bairro`,
            cidade: drizzleSql`excluded.cidade`,
            uf: drizzleSql`excluded.uf`,
            cep: drizzleSql`excluded.cep`,
            email: drizzleSql`excluded.email`,
            fonePrincipal: drizzleSql`excluded.fone_principal`,
            foneSecundario: drizzleSql`excluded.fone_secundario`,
            rgOuIe: drizzleSql`excluded.rg_ou_ie`,
            dataDelete: drizzleSql`excluded.data_delete`,
            versaoReg: drizzleSql`excluded.versao_reg`,
            sincronizadoEm: drizzleSql`excluded.sincronizado_em`,
          },
        });
    }
    fornecedoresRecebidos = rows.length;
  }

  // --- Categorias ---
  if (categorias?.length) {
    const rows = categorias.map((c) => ({
      filialId: filial.id,
      codigoExterno: c.codigoExterno,
      codigoPaiExterno: c.codigoPaiExterno,
      codigoGrupoDreExterno: c.codigoGrupoDreExterno,
      descricao: c.descricao,
      tipo: c.tipo,
      excluidaEm: c.excluidaEm ? new Date(c.excluidaEm) : null,
      versaoReg: c.versaoReg,
      sincronizadoEm: new Date(),
    }));
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await db
        .insert(schema.categoriaConta)
        .values(rows.slice(i, i + CHUNK_SIZE))
        .onConflictDoUpdate({
          target: [schema.categoriaConta.filialId, schema.categoriaConta.codigoExterno],
          set: {
            codigoPaiExterno: drizzleSql`excluded.codigo_pai_externo`,
            codigoGrupoDreExterno: drizzleSql`excluded.codigo_grupo_dre_externo`,
            descricao: drizzleSql`excluded.descricao`,
            tipo: drizzleSql`excluded.tipo`,
            excluidaEm: drizzleSql`excluded.excluida_em`,
            versaoReg: drizzleSql`excluded.versao_reg`,
            sincronizadoEm: drizzleSql`excluded.sincronizado_em`,
          },
        });
    }
    categoriasRecebidas = rows.length;
  }

  // --- Contas bancárias ---
  if (contasBancarias?.length) {
    const rows = contasBancarias.map((c) => ({
      filialId: filial.id,
      codigoExterno: c.codigoExterno,
      descricao: c.descricao,
      banco: c.banco,
      agencia: c.agencia,
      conta: c.conta,
      dataDelete: c.dataDelete ? new Date(c.dataDelete) : null,
      versaoReg: c.versaoReg,
      sincronizadoEm: new Date(),
    }));
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await db
        .insert(schema.contaBancariaConsumer)
        .values(rows.slice(i, i + CHUNK_SIZE))
        .onConflictDoUpdate({
          target: [
            schema.contaBancariaConsumer.filialId,
            schema.contaBancariaConsumer.codigoExterno,
          ],
          set: {
            descricao: drizzleSql`excluded.descricao`,
            banco: drizzleSql`excluded.banco`,
            agencia: drizzleSql`excluded.agencia`,
            conta: drizzleSql`excluded.conta`,
            dataDelete: drizzleSql`excluded.data_delete`,
            versaoReg: drizzleSql`excluded.versao_reg`,
            sincronizadoEm: drizzleSql`excluded.sincronizado_em`,
          },
        });
    }
    contasBancariasRecebidas = rows.length;
  }

  // --- Contas a pagar ---
  // DEDUPE com NFe-origem: antes de inserir cada conta vinda do Consumer, tenta
  // "reivindicar" uma conta_pagar criada por NFe que case com fornecedor +
  // dataVencimento + valor (centavo de tolerancia) e ainda nao tem codigoExterno.
  // Se casar, a NFe-row absorve os metadados Consumer (codigoExterno, dataPagamento,
  // etc.) sem mudar origem='NFE' — a NFe continua sendo a fonte da verdade,
  // e ganhamos o link com o registro do Consumer pra reconciliar pagamentos.
  let contasPagarReivindicadas = 0;
  if (contasPagar?.length) {
    const rows = contasPagar.map((cp) => ({
      filialId: filial.id,
      codigoExterno: cp.codigoExterno,
      codigoFornecedorExterno: cp.codigoFornecedorExterno,
      codigoCategoriaExterno: cp.codigoCategoriaExterno,
      codigoContaBancariaExterno: cp.codigoContaBancariaExterno,
      parcela: cp.parcela,
      totalParcelas: cp.totalParcelas,
      dataVencimento: cp.dataVencimento,
      valor: String(cp.valor),
      dataPagamento: cp.dataPagamento,
      descontos: cp.descontos !== null ? String(cp.descontos) : null,
      jurosMulta: cp.jurosMulta !== null ? String(cp.jurosMulta) : null,
      valorPago: cp.valorPago !== null ? String(cp.valorPago) : null,
      codigoReferencia: cp.codigoReferencia,
      competencia: cp.competencia,
      descricao: cp.descricao,
      observacao: cp.observacao,
      dataCadastro: cp.dataCadastro ? new Date(cp.dataCadastro) : null,
      dataDelete: cp.dataDelete ? new Date(cp.dataDelete) : null,
      versaoReg: cp.versaoReg,
      sincronizadoEm: new Date(),
    }));

    // Pre-pass: tenta reivindicar NFe orfas. Linhas reivindicadas saem do batch
    // e ja foram atualizadas in-place; o resto vai pro upsert normal.
    const rowsParaInserir: typeof rows = [];
    for (const r of rows) {
      // Sem codigoFornecedorExterno nao da pra fazer match (fornecedor eh chave)
      if (r.codigoFornecedorExterno == null) {
        rowsParaInserir.push(r);
        continue;
      }
      const claimed = await db
        .update(schema.contaPagar)
        .set({
          codigoExterno: r.codigoExterno,
          codigoFornecedorExterno: r.codigoFornecedorExterno,
          codigoCategoriaExterno: r.codigoCategoriaExterno,
          codigoContaBancariaExterno: r.codigoContaBancariaExterno,
          dataPagamento: r.dataPagamento,
          descontos: r.descontos,
          jurosMulta: r.jurosMulta,
          valorPago: r.valorPago,
          codigoReferencia: r.codigoReferencia,
          competencia: r.competencia,
          observacao: r.observacao,
          versaoReg: r.versaoReg,
          sincronizadoEm: r.sincronizadoEm,
          // origem MANTEM 'NFE' — NFe segue como fonte de verdade. parcela/total
          // e descricao tambem ficam — vieram do XML e sao mais confiaveis.
        })
        .where(
          and(
            eq(schema.contaPagar.filialId, filial.id),
            eq(schema.contaPagar.origem, 'NFE'),
            isNull(schema.contaPagar.codigoExterno),
            eq(schema.contaPagar.dataVencimento, r.dataVencimento),
            drizzleSql`ABS(${schema.contaPagar.valor} - ${r.valor}::numeric) < 0.01`,
            drizzleSql`${schema.contaPagar.fornecedorId} IN (
              SELECT id FROM fornecedor
              WHERE filial_id = ${filial.id}
                AND codigo_externo = ${r.codigoFornecedorExterno}
            )`,
          ),
        )
        .returning({ id: schema.contaPagar.id });
      if (claimed.length > 0) {
        contasPagarReivindicadas++;
      } else {
        rowsParaInserir.push(r);
      }
    }

    for (let i = 0; i < rowsParaInserir.length; i += CHUNK_SIZE) {
      await db
        .insert(schema.contaPagar)
        .values(rowsParaInserir.slice(i, i + CHUNK_SIZE))
        .onConflictDoUpdate({
          target: [schema.contaPagar.filialId, schema.contaPagar.codigoExterno],
          set: {
            codigoFornecedorExterno: drizzleSql`excluded.codigo_fornecedor_externo`,
            codigoCategoriaExterno: drizzleSql`excluded.codigo_categoria_externo`,
            codigoContaBancariaExterno: drizzleSql`excluded.codigo_conta_bancaria_externo`,
            parcela: drizzleSql`excluded.parcela`,
            totalParcelas: drizzleSql`excluded.total_parcelas`,
            dataVencimento: drizzleSql`excluded.data_vencimento`,
            valor: drizzleSql`excluded.valor`,
            dataPagamento: drizzleSql`excluded.data_pagamento`,
            descontos: drizzleSql`excluded.descontos`,
            jurosMulta: drizzleSql`excluded.juros_multa`,
            valorPago: drizzleSql`excluded.valor_pago`,
            codigoReferencia: drizzleSql`excluded.codigo_referencia`,
            competencia: drizzleSql`excluded.competencia`,
            descricao: drizzleSql`excluded.descricao`,
            observacao: drizzleSql`excluded.observacao`,
            dataCadastro: drizzleSql`excluded.data_cadastro`,
            dataDelete: drizzleSql`excluded.data_delete`,
            versaoReg: drizzleSql`excluded.versao_reg`,
            sincronizadoEm: drizzleSql`excluded.sincronizado_em`,
          },
        });
    }
    contasPagarRecebidas = rows.length;

    // Resolve FKs (fornecedor_id e categoria_id) via update em massa
    await db.execute(drizzleSql`
      UPDATE conta_pagar cp SET fornecedor_id = f.id
      FROM fornecedor f
      WHERE cp.filial_id = ${filial.id}
        AND cp.filial_id = f.filial_id
        AND cp.codigo_fornecedor_externo = f.codigo_externo
        AND cp.fornecedor_id IS NULL
        AND cp.codigo_fornecedor_externo IS NOT NULL
    `);
    await db.execute(drizzleSql`
      UPDATE conta_pagar cp SET categoria_id = c.id
      FROM categoria_conta c
      WHERE cp.filial_id = ${filial.id}
        AND cp.filial_id = c.filial_id
        AND cp.codigo_categoria_externo = c.codigo_externo
        AND cp.categoria_id IS NULL
        AND cp.codigo_categoria_externo IS NOT NULL
    `);
  }

  // --- Clientes ---
  if (clientes?.length) {
    const rows = clientes.map((c) => ({
      filialId: filial.id,
      codigoExterno: c.codigoExterno,
      cpfOuCnpj: c.cpfOuCnpj?.replace(/\D/g, '').slice(0, 14) || null,
      nome: c.nome,
      email: c.email,
      telefone: c.telefone,
      dataDelete: c.dataDelete ? new Date(c.dataDelete) : null,
      versaoReg: c.versaoReg,
      sincronizadoEm: new Date(),
    }));
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await db
        .insert(schema.cliente)
        .values(rows.slice(i, i + CHUNK_SIZE))
        .onConflictDoUpdate({
          target: [schema.cliente.filialId, schema.cliente.codigoExterno],
          set: {
            cpfOuCnpj: drizzleSql`excluded.cpf_ou_cnpj`,
            nome: drizzleSql`excluded.nome`,
            email: drizzleSql`excluded.email`,
            telefone: drizzleSql`excluded.telefone`,
            dataDelete: drizzleSql`excluded.data_delete`,
            versaoReg: drizzleSql`excluded.versao_reg`,
            sincronizadoEm: drizzleSql`excluded.sincronizado_em`,
          },
        });
    }
    clientesRecebidos = rows.length;
  }

  // --- Movimentos conta corrente ---
  if (movimentosContaCorrente?.length) {
    const rows = movimentosContaCorrente.map((m) => ({
      filialId: filial.id,
      codigoExterno: m.codigoExterno,
      codigoClienteExterno: m.codigoClienteExterno,
      codigoPedidoExterno: m.codigoPedidoExterno,
      dataHora: m.dataHora ? new Date(m.dataHora) : null,
      saldoInicial: m.saldoInicial !== null ? String(m.saldoInicial) : null,
      credito: m.credito !== null ? String(m.credito) : null,
      debito: m.debito !== null ? String(m.debito) : null,
      saldoFinal: m.saldoFinal !== null ? String(m.saldoFinal) : null,
      codigoPagamento: m.codigoPagamento,
      codigoUsuario: m.codigoUsuario,
      codigoContaEstornada: m.codigoContaEstornada,
      observacao: m.observacao,
      importado: m.importado,
      versaoReg: m.versaoReg,
      sincronizadoEm: new Date(),
    }));
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await db
        .insert(schema.movimentoContaCorrente)
        .values(rows.slice(i, i + CHUNK_SIZE))
        .onConflictDoUpdate({
          target: [
            schema.movimentoContaCorrente.filialId,
            schema.movimentoContaCorrente.codigoExterno,
          ],
          set: {
            codigoClienteExterno: drizzleSql`excluded.codigo_cliente_externo`,
            codigoPedidoExterno: drizzleSql`excluded.codigo_pedido_externo`,
            dataHora: drizzleSql`excluded.data_hora`,
            saldoInicial: drizzleSql`excluded.saldo_inicial`,
            credito: drizzleSql`excluded.credito`,
            debito: drizzleSql`excluded.debito`,
            saldoFinal: drizzleSql`excluded.saldo_final`,
            codigoPagamento: drizzleSql`excluded.codigo_pagamento`,
            codigoUsuario: drizzleSql`excluded.codigo_usuario`,
            codigoContaEstornada: drizzleSql`excluded.codigo_conta_estornada`,
            observacao: drizzleSql`excluded.observacao`,
            importado: drizzleSql`excluded.importado`,
            versaoReg: drizzleSql`excluded.versao_reg`,
            sincronizadoEm: drizzleSql`excluded.sincronizado_em`,
          },
        });
    }
    movimentosRecebidos = rows.length;

    // Resolve FK cliente_id apos insert
    await db.execute(drizzleSql`
      UPDATE movimento_conta_corrente mcc SET cliente_id = c.id
      FROM cliente c
      WHERE mcc.filial_id = ${filial.id}
        AND mcc.filial_id = c.filial_id
        AND mcc.codigo_cliente_externo = c.codigo_externo
        AND mcc.cliente_id IS NULL
        AND mcc.codigo_cliente_externo IS NOT NULL
    `);
  }

  return NextResponse.json({
    fornecedoresRecebidos,
    categoriasRecebidas,
    contasBancariasRecebidas,
    contasPagarRecebidas,
    contasPagarReivindicadas,
    clientesRecebidos,
    movimentosRecebidos,
  });
}
