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

  // Acordo da lotação principal manda como PONTO DE PARTIDA — quem é gerente
  // fixo por dia numa casa entra assim na outra (depois dá pra mudar por loja
  // em /rh/funcionarios). Copiar só o papel deixava gerente sem modelo:
  // cai em "1pp dos 10%" e, com pp_gerente=0 na loja, some da folha
  // (Cauã/Prainha Bar 14–20/09/2026: 7 dias de ponto e R$ 0). Bônus NÃO
  // copia — bônus fixo semanal nas duas casas pagaria duas vezes.
  let acordo: {
    papel: string;
    gerenteModelo: string | null;
    gerenteValorFixoDia: string | null;
    diaristaModelo: string;
    diaristaValorFixoDia: string | null;
    diaristaTaxaHoraOverride: string | null;
  } = {
    papel: 'funcionario',
    gerenteModelo: null,
    gerenteValorFixoDia: null,
    diaristaModelo: 'por_hora',
    diaristaValorFixoDia: null,
    diaristaTaxaHoraOverride: null,
  };
  if (fn.fornecedorId) {
    const [principal] = await tx
      .select({
        papel: schema.fornecedorFolha.papel,
        gerenteModelo: schema.fornecedorFolha.gerenteModelo,
        gerenteValorFixoDia: schema.fornecedorFolha.gerenteValorFixoDia,
        diaristaModelo: schema.fornecedorFolha.diaristaModelo,
        diaristaValorFixoDia: schema.fornecedorFolha.diaristaValorFixoDia,
        diaristaTaxaHoraOverride: schema.fornecedorFolha.diaristaTaxaHoraOverride,
      })
      .from(schema.fornecedorFolha)
      .where(eq(schema.fornecedorFolha.fornecedorId, fn.fornecedorId))
      .limit(1);
    if (principal) acordo = principal;
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

    // CPF do cliente pode estar formatado (000.000.000-00) — compara dígitos.
    const [cli] = await tx
      .select({ id: schema.cliente.id })
      .from(schema.cliente)
      .where(
        and(
          eq(schema.cliente.filialId, filialId),
          sql`regexp_replace(coalesce(${schema.cliente.cpfOuCnpj}, ''), '[^0-9]', '', 'g') = ${fn.cpf}`,
          isNull(schema.cliente.dataDelete),
        ),
      )
      .limit(1);

    await tx
      .insert(schema.fornecedorFolha)
      .values({
        fornecedorId,
        papel: acordo.papel,
        gerenteModelo: acordo.gerenteModelo,
        gerenteValorFixoDia: acordo.gerenteValorFixoDia,
        diaristaModelo: acordo.diaristaModelo,
        diaristaValorFixoDia: acordo.diaristaValorFixoDia,
        diaristaTaxaHoraOverride: acordo.diaristaTaxaHoraOverride,
        ativo: true,
        clienteId: cli?.id ?? null,
        nomesAlternativos: nomes,
      })
      .onConflictDoUpdate({
        target: schema.fornecedorFolha.fornecedorId,
        set: {
          ativo: true,
          // Cliente e acordo já ajustados na mão na outra casa mandam —
          // só preenche o que está vazio.
          clienteId: sql`coalesce(${schema.fornecedorFolha.clienteId}, excluded.cliente_id)`,
          gerenteModelo: sql`coalesce(${schema.fornecedorFolha.gerenteModelo}, excluded.gerente_modelo)`,
          gerenteValorFixoDia: sql`coalesce(${schema.fornecedorFolha.gerenteValorFixoDia}, excluded.gerente_valor_fixo_dia)`,
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
