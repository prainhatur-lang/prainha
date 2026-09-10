// Marcar "também trabalha em" no cadastro do RH tem que bastar: sem isso a
// pessoa bate ponto na outra loja mas some da folha de lá (o espelho só casa
// nome contra quem tem fornecedor_folha, então as horas eram descartadas).

import { schema } from '@concilia/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

type Tx = Parameters<Parameters<typeof import('@concilia/db').db.transaction>[0]>[0];

export interface ResultadoVinculo {
  filialId: string;
  fornecedorId: string;
  fornecedorCriado: boolean;
  clienteVinculado: boolean;
}

/** Garante fornecedor + fornecedor_folha ativos em cada filial extra, casando
 *  por CPF. Sem CPF não dá pra casar com segurança — nesses casos não faz nada. */
export async function garantirVinculoFolhaNasFiliais(
  tx: Tx,
  funcionarioId: string,
  filiaisExtras: string[],
): Promise<ResultadoVinculo[]> {
  if (filiaisExtras.length === 0) return [];

  const [fn] = await tx
    .select({
      nome: schema.funcionario.nome,
      cpf: schema.funcionario.cpf,
      cargo: schema.funcionario.cargo,
      fornecedorId: schema.funcionario.fornecedorId,
    })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, funcionarioId))
    .limit(1);
  if (!fn?.cpf) return [];

  // Papel na lotação principal manda — quem é gerente numa casa é gerente na
  // outra. Sem vínculo principal ainda, entra como funcionário.
  let papel = 'funcionario';
  if (fn.fornecedorId) {
    const [principal] = await tx
      .select({ papel: schema.fornecedorFolha.papel })
      .from(schema.fornecedorFolha)
      .where(eq(schema.fornecedorFolha.fornecedorId, fn.fornecedorId))
      .limit(1);
    if (principal) papel = principal.papel;
  }

  const nomes = [...new Set([fn.nome, fn.cargo ? `${fn.nome} (${fn.cargo})` : null].filter(Boolean))] as string[];
  const out: ResultadoVinculo[] = [];

  for (const filialId of filiaisExtras) {
    const [existente] = await tx
      .select({ id: schema.fornecedor.id })
      .from(schema.fornecedor)
      .where(
        and(
          eq(schema.fornecedor.filialId, filialId),
          eq(schema.fornecedor.cnpjOuCpf, fn.cpf),
          isNull(schema.fornecedor.dataDelete),
        ),
      )
      .limit(1);

    let fornecedorId = existente?.id;
    if (!fornecedorId) {
      const [novo] = await tx
        .insert(schema.fornecedor)
        .values({ filialId, nome: fn.nome, cnpjOuCpf: fn.cpf })
        .returning({ id: schema.fornecedor.id });
      fornecedorId = novo.id;
    }

    const [cli] = await tx
      .select({ id: schema.cliente.id })
      .from(schema.cliente)
      .where(
        and(
          eq(schema.cliente.filialId, filialId),
          eq(schema.cliente.cpfOuCnpj, fn.cpf),
          isNull(schema.cliente.dataDelete),
        ),
      )
      .limit(1);

    await tx
      .insert(schema.fornecedorFolha)
      .values({
        fornecedorId,
        papel,
        ativo: true,
        clienteId: cli?.id ?? null,
        nomesAlternativos: nomes,
      })
      .onConflictDoUpdate({
        target: schema.fornecedorFolha.fornecedorId,
        set: {
          ativo: true,
          // Cliente e papel já ajustados na mão na outra casa mandam.
          clienteId: sql`coalesce(${schema.fornecedorFolha.clienteId}, excluded.cliente_id)`,
          nomesAlternativos: sql`excluded.nomes_alternativos`,
        },
      });

    out.push({
      filialId,
      fornecedorId,
      fornecedorCriado: !existente,
      clienteVinculado: Boolean(cli),
    });
  }

  return out;
}
