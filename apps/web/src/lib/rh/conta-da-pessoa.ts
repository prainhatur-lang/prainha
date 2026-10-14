// Conta bancária/PIX de quem circula entre casas. O fornecedor é por filial,
// então cada casa tem a própria cópia da conta — e ela era digitada numa só:
// marcar "também bate ponto em" criava o fornecedor da outra casa SEM conta e
// o pagamento de lá saía "⚠ sem conta cadastrada" (dono, 14/10/2026). Aqui
// acha a conta que a pessoa já tem em alguma casa, pelo CPF.

import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

export interface ContaPessoa {
  chavePix: string | null;
  bancoNome: string | null;
  bancoAgencia: string | null;
  bancoConta: string | null;
  /** Casa de onde a conta veio. */
  filialId: string;
  filialNome: string;
}

export function temConta(c: { chavePix?: string | null; bancoConta?: string | null } | null | undefined): boolean {
  return Boolean(c?.chavePix?.trim() || c?.bancoConta?.trim());
}

const cpfDoFornecedor = sql<string>`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '[^0-9]', '', 'g')`;

/** Conta/PIX que cada CPF já tem cadastrada em OUTRA casa (fora `excetoFilialId`).
 *  A da lotação principal (funcionario.fornecedor_id) ganha; senão qualquer
 *  casa onde a pessoa está na folha. */
export async function contasPorCpf(cpfs: string[], excetoFilialId: string): Promise<Map<string, ContaPessoa>> {
  const lista = [...new Set(cpfs.map((c) => c.replace(/\D/g, '')).filter((c) => c.length === 11))];
  const out = new Map<string, ContaPessoa>();
  if (lista.length === 0) return out;

  const rows = await db
    .select({
      cpf: cpfDoFornecedor,
      chavePix: schema.fornecedor.chavePix,
      bancoNome: schema.fornecedor.bancoNome,
      bancoAgencia: schema.fornecedor.bancoAgencia,
      bancoConta: schema.fornecedor.bancoConta,
      filialId: schema.fornecedor.filialId,
      filialNome: schema.filial.nome,
      principal: sql<boolean>`exists (select 1 from funcionario fu where fu.fornecedor_id = ${schema.fornecedor.id})`,
    })
    .from(schema.fornecedor)
    .innerJoin(schema.fornecedorFolha, eq(schema.fornecedorFolha.fornecedorId, schema.fornecedor.id))
    .innerJoin(schema.filial, eq(schema.filial.id, schema.fornecedor.filialId))
    .where(
      and(
        sql`${schema.fornecedor.filialId} <> ${excetoFilialId}`,
        isNull(schema.fornecedor.dataDelete),
        inArray(cpfDoFornecedor, lista),
        sql`(nullif(trim(${schema.fornecedor.chavePix}), '') is not null or nullif(trim(${schema.fornecedor.bancoConta}), '') is not null)`,
      ),
    );

  for (const r of rows) {
    const atual = out.get(r.cpf);
    if (atual && !r.principal) continue;
    out.set(r.cpf, {
      chavePix: r.chavePix,
      bancoNome: r.bancoNome,
      bancoAgencia: r.bancoAgencia,
      bancoConta: r.bancoConta,
      filialId: r.filialId,
      filialNome: r.filialNome,
    });
  }
  return out;
}
