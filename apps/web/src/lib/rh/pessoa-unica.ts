// CADASTRO ÚNICO DE PESSOA — uma pessoa, três papéis.
//
// A mesma pessoa é (ou pode virar) as três coisas na casa:
//   • FUNCIONÁRIO — trabalha (ponto, folha, RH)
//   • FORNECEDOR  — RECEBE (é assim que a folha paga: conta_pagar por fornecedor)
//   • CLIENTE     — CONSOME (fiado na conta corrente, que a folha desconta)
//
// O modelo do Consumer separa em três tabelas e o Concilia espelha isso — mas
// o usuário NÃO deve ter que cadastrar três vezes a mesma pessoa.
//
// ⚠️ PAPEL É ESCOLHA, NÃO CONSEQUÊNCIA (dono, 31/08/2026): "se eu cadastrar um
// vendedor e quiser, ele vai ser um cliente; se cadastrar um cliente, ele PODE
// ser um vendedor — não quer dizer que ele SEJA". Por isso o cliente só nasce
// quando quem cadastra pede (`tambemCliente`). O fornecedor é a exceção
// necessária: sem ele não existe como pagar a folha da pessoa.
//
// Casamento é sempre por CPF (chave forte). Sem CPF, cai pro telefone; sem
// nenhum dos dois, cria pelo nome — aqui é seguro porque funcionário é gente
// conhecida da casa, não um cliente aleatório do salão.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';

const soDigitos = (s?: string | null) => (s ?? '').replace(/\D/g, '');

export interface PapeisGarantidos {
  fornecedorId: string;
  clienteId: string | null;
  /** true quando a linha foi criada agora (pra UI dizer o que aconteceu) */
  criouFornecedor: boolean;
  criouCliente: boolean;
  /** id do comando enfileirado pra loja criar o cliente no Consumer */
  comandoLojaId: string | null;
}

/**
 * Garante fornecedor + cliente da pessoa e amarra tudo no funcionário.
 *
 * `enfileirarNaLoja`: quando true e o cliente nasceu na nuvem, manda a loja
 * criar o contato no Consumer também — sem isso o caixa não acha a pessoa
 * na hora do fiado (o PDV lê o Firebird, não a nuvem).
 */
export async function garantirPapeisDaPessoa(
  funcionarioId: string,
  opcoes: {
    criadoPor?: string;
    enfileirarNaLoja?: boolean;
    /** Marcar a pessoa TAMBÉM como cliente (consumo/fiado). Sem isso o papel
     *  de cliente não é criado — quem cadastra decide. Um vínculo de cliente
     *  que já exista continua sendo respeitado. */
    tambemCliente?: boolean;
  } = {},
): Promise<PapeisGarantidos | null> {
  const [func] = await db
    .select({
      id: schema.funcionario.id,
      filialId: schema.funcionario.filialId,
      nome: schema.funcionario.nome,
      cpf: schema.funcionario.cpf,
      telefone: schema.funcionario.telefone,
      fornecedorId: schema.funcionario.fornecedorId,
    })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, funcionarioId))
    .limit(1);
  if (!func) return null;

  const cpf = soDigitos(func.cpf);
  const fone = soDigitos(func.telefone);
  const nome = func.nome.trim();

  // ---------- 1) FORNECEDOR (quem recebe) ----------
  let fornecedorId = func.fornecedorId;
  let criouFornecedor = false;
  if (!fornecedorId) {
    // Já existe fornecedor dessa pessoa na filial? (CPF é a chave forte)
    let achado: { id: string } | undefined;
    if (cpf) {
      [achado] = await db
        .select({ id: schema.fornecedor.id })
        .from(schema.fornecedor)
        .where(
          and(
            eq(schema.fornecedor.filialId, func.filialId),
            isNull(schema.fornecedor.dataDelete),
            sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '[^0-9]', '', 'g') = ${cpf}`,
          ),
        )
        .limit(1);
    }
    if (achado) {
      fornecedorId = achado.id;
    } else {
      const [novo] = await db
        .insert(schema.fornecedor)
        .values({
          filialId: func.filialId,
          nome,
          cnpjOuCpf: cpf || null,
          fonePrincipal: fone || null,
        })
        .returning({ id: schema.fornecedor.id });
      fornecedorId = novo!.id;
      criouFornecedor = true;
    }
    await db
      .update(schema.funcionario)
      .set({ fornecedorId, atualizadoEm: new Date() })
      .where(eq(schema.funcionario.id, funcionarioId));
  }

  // ---------- 2) CLIENTE (quem consome / faz fiado) ----------
  // Casa por CPF; sem CPF, pelos últimos 8 dígitos do telefone (mesma regra
  // da unificação da tela de clientes).
  let clienteId: string | null = null;
  let criouCliente = false;

  if (cpf) {
    const [achado] = await db
      .select({ id: schema.cliente.id })
      .from(schema.cliente)
      .where(
        and(
          eq(schema.cliente.filialId, func.filialId),
          isNull(schema.cliente.dataDelete),
          sql`regexp_replace(coalesce(${schema.cliente.cpfOuCnpj}, ''), '[^0-9]', '', 'g') = ${cpf}`,
        ),
      )
      .limit(1);
    clienteId = achado?.id ?? null;
  }
  if (!clienteId && fone.length >= 10) {
    const [achado] = await db
      .select({ id: schema.cliente.id })
      .from(schema.cliente)
      .where(
        and(
          eq(schema.cliente.filialId, func.filialId),
          isNull(schema.cliente.dataDelete),
          sql`right(regexp_replace(coalesce(${schema.cliente.celular}, ${schema.cliente.telefone}, ''), '[^0-9]', '', 'g'), 8) = ${fone.slice(-8)}`,
        ),
      )
      .limit(1);
    clienteId = achado?.id ?? null;
  }

  // Não achou cliente e ninguém pediu o papel? Fica sem — a pessoa trabalha
  // aqui sem consumir fiado, e isso é normal.
  if (!clienteId && !opcoes.tambemCliente) {
    return {
      fornecedorId: fornecedorId!,
      clienteId: null,
      criouFornecedor,
      criouCliente: false,
      comandoLojaId: null,
    };
  }

  if (!clienteId) {
    // Nasce na nuvem com codigo_externo NEGATIVO (o do Consumer é positivo);
    // quando o agente sincronizar e casar por CPF, ele preenche o código real
    // em vez de duplicar — mesmo padrão do fornecedor criado na nuvem.
    const [minRow] = await db
      .select({ min: sql<number>`min(${schema.cliente.codigoExterno})` })
      .from(schema.cliente)
      .where(eq(schema.cliente.filialId, func.filialId));
    const codigoFake = Math.min(-1, (minRow?.min ?? 0) - 1);

    const [novo] = await db
      .insert(schema.cliente)
      .values({
        filialId: func.filialId,
        codigoExterno: codigoFake,
        nome,
        cpfOuCnpj: cpf || null,
        celular: fone || null,
        sincronizadoEm: new Date(),
      })
      .returning({ id: schema.cliente.id });
    clienteId = novo!.id;
    criouCliente = true;
  }

  // ---------- 3) AMARRA no vínculo da folha ----------
  // Só se a pessoa já tem linha na folha (fornecedor_folha). Quem ainda não
  // tem papel definido recebe o clienteId quando o papel for escolhido.
  await db
    .update(schema.fornecedorFolha)
    .set({ clienteId, atualizadoEm: new Date() })
    .where(eq(schema.fornecedorFolha.fornecedorId, fornecedorId!));

  // ---------- 4) LOJA: sem contato no Consumer, não há fiado no caixa ----------
  let comandoLojaId: string | null = null;
  if (criouCliente && opcoes.enfileirarNaLoja) {
    const [cmd] = await db
      .insert(schema.agenteComando)
      .values({
        filialId: func.filialId,
        tipo: 'criar_cliente',
        payload: {
          campos: {
            nome,
            ...(cpf ? { cpfCnpj: cpf } : {}),
            ...(fone ? { celular: fone, telefone: fone } : {}),
          },
          // pra nuvem casar o CODIGO devolvido pela trigger com a linha certa
          clienteIdNuvem: clienteId,
        },
        criadoPor: opcoes.criadoPor ?? null,
      })
      .returning({ id: schema.agenteComando.id });
    comandoLojaId = cmd?.id ?? null;
  }

  return { fornecedorId: fornecedorId!, clienteId, criouFornecedor, criouCliente, comandoLojaId };
}

/**
 * Caminho INVERSO: marca um cliente como fornecedor (vendedor) também.
 *
 * Mesmo princípio — é escolha de quem cadastra, nunca automático: "se eu
 * cadastrar um cliente, ele PODE ser um vendedor; não quer dizer que ele
 * SEJA" (dono, 31/08/2026). Reaproveita o fornecedor que já existir com o
 * mesmo CPF/CNPJ na filial em vez de duplicar a pessoa.
 */
export async function marcarClienteComoFornecedor(
  clienteId: string,
): Promise<{ fornecedorId: string; criou: boolean } | null> {
  const [cli] = await db
    .select({
      id: schema.cliente.id,
      filialId: schema.cliente.filialId,
      nome: schema.cliente.nome,
      doc: schema.cliente.cpfOuCnpj,
      celular: schema.cliente.celular,
      telefone: schema.cliente.telefone,
      email: schema.cliente.email,
    })
    .from(schema.cliente)
    .where(eq(schema.cliente.id, clienteId))
    .limit(1);
  if (!cli) return null;

  const doc = soDigitos(cli.doc);
  const fone = soDigitos(cli.celular ?? cli.telefone);

  if (doc) {
    const [achado] = await db
      .select({ id: schema.fornecedor.id })
      .from(schema.fornecedor)
      .where(
        and(
          eq(schema.fornecedor.filialId, cli.filialId),
          isNull(schema.fornecedor.dataDelete),
          sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '[^0-9]', '', 'g') = ${doc}`,
        ),
      )
      .limit(1);
    if (achado) return { fornecedorId: achado.id, criou: false };
  }

  const [novo] = await db
    .insert(schema.fornecedor)
    .values({
      filialId: cli.filialId,
      nome: (cli.nome ?? '').trim() || 'Sem nome',
      cnpjOuCpf: doc || null,
      fonePrincipal: fone || null,
      email: cli.email ?? null,
    })
    .returning({ id: schema.fornecedor.id });
  return { fornecedorId: novo!.id, criou: true };
}
