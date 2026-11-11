// Cadastro único do Pix de cada empresa do sistema (pedido do dono 11/11/2026:
// "faz um cadastro único de Pix de cada empresa pra a gente não ficar
// perguntando toda hora qual é o Pix"). A chave mora em filial.pix_transf_* —
// é onde a empresa RECEBE das outras (empréstimo/mútuo, repasse entre casas) —
// e vale pro cadastro dela como fornecedor (mesmo CNPJ) em todas as outras.
//
// Chave só entra aqui pela mão do dono (Admin). Nada é deduzido de CNPJ.
// Tela: /financeiro/emprestimos.

import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { conferirChavePix } from '@/lib/pix-titular';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class RecusaEmpresaPix extends Error {}

const so = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

export type EmpresaPix = {
  id: string;
  nome: string;
  cnpj: string;
  chave: string | null;
  favorecido: string | null;
  /** cadastros dela como fornecedor nas empresas (mesmo CNPJ) */
  cadastros: number;
  /** quantos desses estão com a chave do cadastro único */
  iguais: number;
};

export async function listarPixDasEmpresas(filialIds: string[]): Promise<EmpresaPix[]> {
  if (!filialIds.length) return [];
  const lista = sql.join(filialIds.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = (await db.execute(sql`
    SELECT e.id, e.nome, e.cnpj, e.pix_transf_chave AS chave, e.pix_transf_favorecido AS favorecido,
           (SELECT COUNT(*) FROM fornecedor fo
             WHERE fo.data_delete IS NULL
               AND regexp_replace(coalesce(fo.cnpj_ou_cpf, ''), '\\D', '', 'g') = regexp_replace(coalesce(e.cnpj, ''), '\\D', '', 'g'))::int AS cadastros,
           (SELECT COUNT(*) FROM fornecedor fo
             WHERE fo.data_delete IS NULL
               AND regexp_replace(coalesce(fo.cnpj_ou_cpf, ''), '\\D', '', 'g') = regexp_replace(coalesce(e.cnpj, ''), '\\D', '', 'g')
               AND btrim(coalesce(fo.chave_pix, '')) = btrim(coalesce(e.pix_transf_chave, '')))::int AS iguais
      FROM filial e
     WHERE e.id IN (${lista})
     ORDER BY e.nome
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    nome: String(r.nome),
    cnpj: String(r.cnpj ?? ''),
    chave: (r.chave as string | null) ?? null,
    favorecido: (r.favorecido as string | null) ?? null,
    cadastros: Number(r.cadastros),
    iguais: r.chave ? Number(r.iguais) : 0,
  }));
}

/** Grava a chave autorizada da empresa e leva pra todos os cadastros dela como
 *  fornecedor (mesmo CNPJ), em qualquer empresa. Devolve quantos atualizou. */
export async function definirPixDaEmpresa(p: {
  usuarioId: string;
  filialId: string;
  chave: string;
  favorecido: string | null;
}): Promise<{ cadastros: number }> {
  const chave = p.chave.trim();
  const favorecido = p.favorecido?.trim() || null;
  if (!chave) throw new RecusaEmpresaPix('digite a chave Pix');
  if (chave.length > 100) throw new RecusaEmpresaPix('chave Pix grande demais');
  const [e] = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome, cnpj: schema.filial.cnpj })
    .from(schema.filial)
    .where(eq(schema.filial.id, p.filialId))
    .limit(1);
  if (!e) throw new RecusaEmpresaPix('empresa não encontrada');
  const doc = so(e.cnpj);
  if (doc.length !== 14) throw new RecusaEmpresaPix(`${e.nome} está sem CNPJ no cadastro da empresa`);
  const conf = conferirChavePix({ chave, docFornecedor: doc, favorecido });
  if (!conf || conf.tipo === 'DESCONHECIDA') throw new RecusaEmpresaPix('essa chave Pix não parece válida (CNPJ, e-mail, telefone com +55 ou chave aleatória)');
  if (conf.nivel === 'diverge') throw new RecusaEmpresaPix(`${conf.msg} — se o Pix cai em nome de outro, preencha "quem recebe"`);

  return db.transaction(async (tx) => {
    await tx
      .update(schema.filial)
      .set({ pixTransfChave: chave, pixTransfFavorecido: favorecido, pixTransfPor: p.usuarioId, pixTransfEm: new Date() })
      .where(eq(schema.filial.id, e.id));
    const up = (await tx.execute(sql`
      UPDATE fornecedor
         SET chave_pix = ${chave}, pix_favorecido = ${favorecido}
       WHERE data_delete IS NULL
         AND regexp_replace(coalesce(cnpj_ou_cpf, ''), '\\D', '', 'g') = ${doc}
         AND (btrim(coalesce(chave_pix, '')) <> ${chave} OR coalesce(btrim(pix_favorecido), '') <> ${favorecido ?? ''})
      RETURNING id
    `)) as unknown as unknown[];
    return { cadastros: up.length };
  });
}

/** Chave do cadastro único da empresa (ou null). Pra quem cria o fornecedor dela em outra empresa. */
export async function pixDaEmpresa(tx: Tx, filialId: string): Promise<{ chave: string; favorecido: string | null } | null> {
  const [e] = await tx
    .select({ chave: schema.filial.pixTransfChave, favorecido: schema.filial.pixTransfFavorecido })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const chave = e?.chave?.trim();
  return chave ? { chave, favorecido: e?.favorecido?.trim() || null } : null;
}
