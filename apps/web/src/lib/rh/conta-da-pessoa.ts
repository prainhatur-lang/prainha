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
 *  casa onde a pessoa está na folha.
 *  `soComBanco`: só vale cadastro com CONTA BANCÁRIA (ignora o que só tem PIX) —
 *  pra quem tem PIX nesta casa mas a conta digitada só em outra. */
export async function contasPorCpf(
  cpfs: string[],
  excetoFilialId: string,
  opts?: { soComBanco?: boolean },
): Promise<Map<string, ContaPessoa>> {
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
    .leftJoin(schema.fornecedorFolha, eq(schema.fornecedorFolha.fornecedorId, schema.fornecedor.id))
    .innerJoin(schema.filial, eq(schema.filial.id, schema.fornecedor.filialId))
    .where(
      and(
        sql`${schema.fornecedor.filialId} <> ${excetoFilialId}`,
        isNull(schema.fornecedor.dataDelete),
        inArray(cpfDoFornecedor, lista),
        // soComBanco vale também o cadastro da empresa que registra (E.B.), que
        // não tem linha em fornecedor_folha; o jeito antigo segue exigindo a folha.
        opts?.soComBanco
          ? sql`nullif(trim(${schema.fornecedor.bancoConta}), '') is not null`
          : sql`${schema.fornecedorFolha.fornecedorId} is not null and (nullif(trim(${schema.fornecedor.chavePix}), '') is not null or nullif(trim(${schema.fornecedor.bancoConta}), '') is not null)`,
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

type ContaCampos = {
  chavePix: string | null;
  bancoNome: string | null;
  bancoAgencia: string | null;
  bancoConta: string | null;
};

/**
 * A conta é da PESSOA, mas cada casa guarda a própria cópia (fornecedor é por
 * filial) — e as cópias divergiam: a conta ficava numa casa e a outra saía
 * "⚠ sem conta cadastrada" (dono, 19/11/2026: "pq vive perdendo essas
 * informações"). Ao salvar numa casa, repassa pros outros cadastros do mesmo
 * CPF, cada lado por si:
 *  - CONTA BANCÁRIA vai pra onde a conta está vazia ou é a cópia antiga daqui;
 *  - PIX vai pra onde o Pix está vazio ou é a cópia antiga daqui.
 * Conta ou Pix DIFERENTE digitado de propósito em outra casa fica como está, e
 * apagar aqui não apaga nas outras. Devolve quantos cadastros mudaram.
 */
export async function repassarContaDaPessoa(p: {
  cpf: string | null | undefined;
  /** Cadastro que acabou de ser salvo (fica de fora). */
  fornecedorId: string;
  antes: Partial<ContaCampos> | null | undefined;
  nova: ContaCampos;
}): Promise<number> {
  const cpf = (p.cpf ?? '').replace(/\D/g, '');
  if (cpf.length !== 11) return 0;
  const t = (v: string | null | undefined) => v?.trim() || null;
  const outros = and(
    sql`${schema.fornecedor.id} <> ${p.fornecedorId}`,
    isNull(schema.fornecedor.dataDelete),
    sql`${cpfDoFornecedor} = ${cpf}`,
  );
  const mudou = new Set<string>();

  const conta = t(p.nova.bancoConta);
  if (conta) {
    const contaAntes = t(p.antes?.bancoConta);
    const agAntes = t(p.antes?.bancoAgencia);
    const copiaAntiga = contaAntes
      ? sql`(trim(${schema.fornecedor.bancoConta}) = ${contaAntes} and coalesce(trim(${schema.fornecedor.bancoAgencia}), '') = ${agAntes ?? ''})`
      : sql`false`;
    const r = await db
      .update(schema.fornecedor)
      .set({ bancoNome: t(p.nova.bancoNome), bancoAgencia: t(p.nova.bancoAgencia), bancoConta: conta })
      .where(and(outros, sql`(nullif(trim(${schema.fornecedor.bancoConta}), '') is null or ${copiaAntiga})`))
      .returning({ id: schema.fornecedor.id });
    for (const x of r) mudou.add(x.id);
  }

  const pix = t(p.nova.chavePix);
  if (pix) {
    const pixAntes = t(p.antes?.chavePix);
    const copiaAntiga = pixAntes ? sql`trim(${schema.fornecedor.chavePix}) = ${pixAntes}` : sql`false`;
    const r = await db
      .update(schema.fornecedor)
      .set({ chavePix: pix })
      .where(and(outros, sql`(nullif(trim(${schema.fornecedor.chavePix}), '') is null or ${copiaAntiga})`))
      .returning({ id: schema.fornecedor.id });
    for (const x of r) mudou.add(x.id);
  }
  return mudou.size;
}
