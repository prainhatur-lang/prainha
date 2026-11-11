// Cadastro único do Pix de cada empresa do sistema (pedido do dono 11/11/2026:
// "faz um cadastro único de Pix de cada empresa pra a gente não ficar
// perguntando toda hora qual é o Pix"). A chave mora em filial.pix_transf_* —
// é onde a empresa RECEBE das outras (empréstimo/mútuo, repasse entre casas) —
// e vale pro cadastro dela como fornecedor (mesmo CNPJ) em todas as outras.
//
// Uma empresa tem MAIS DE UMA chave, cada uma num banco (dono, 11/11/2026: "tem
// um Pix que é o CNPJ, de um banco; tem a chave aleatória, que é de outro
// banco"). Todas ficam em empresa_pix_chave com o banco; a `principal` é a que
// está em filial.pix_transf_* e vai pro cadastro de fornecedor.
//
// Chave só entra aqui pela mão do dono (Admin). Nada é deduzido de CNPJ.
// Tela: /financeiro/emprestimos.

import { db, schema } from '@concilia/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { conferirChavePix } from '@/lib/pix-titular';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class RecusaEmpresaPix extends Error {}

const so = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

export type ChaveDaEmpresa = {
  id: string;
  chave: string;
  banco: string | null;
  favorecido: string | null;
  principal: boolean;
};

export type EmpresaPix = {
  id: string;
  nome: string;
  cnpj: string;
  chave: string | null;
  favorecido: string | null;
  /** banco da chave principal, se anotado */
  banco: string | null;
  /** todas as chaves da empresa (a principal primeiro) */
  chaves: ChaveDaEmpresa[];
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
  const todas = (await db.execute(sql`
    SELECT c.id, c.filial_id, c.chave, c.banco, c.favorecido, c.principal
      FROM empresa_pix_chave c
     WHERE c.filial_id IN (${lista}) AND c.removido_em IS NULL
     ORDER BY c.principal DESC, c.criado_em
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const chave = (r.chave as string | null) ?? null;
    const chaves: ChaveDaEmpresa[] = todas
      .filter((c) => String(c.filial_id) === String(r.id))
      .map((c) => ({
        id: String(c.id),
        chave: String(c.chave),
        banco: (c.banco as string | null) ?? null,
        favorecido: (c.favorecido as string | null) ?? null,
        principal: !!c.principal,
      }));
    return {
      id: String(r.id),
      nome: String(r.nome),
      cnpj: String(r.cnpj ?? ''),
      chave,
      favorecido: (r.favorecido as string | null) ?? null,
      banco: chaves.find((c) => c.principal && c.chave === (chave ?? '').trim())?.banco ?? null,
      chaves,
      cadastros: Number(r.cadastros),
      iguais: chave ? Number(r.iguais) : 0,
    };
  });
}

/** Confere a chave contra o CNPJ da empresa (mesma regra dos fornecedores). */
async function validar(filialId: string, chaveBruta: string, favorecido: string | null) {
  const chave = chaveBruta.trim();
  if (!chave) throw new RecusaEmpresaPix('digite a chave Pix');
  if (chave.length > 100) throw new RecusaEmpresaPix('chave Pix grande demais');
  const [e] = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome, cnpj: schema.filial.cnpj })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  if (!e) throw new RecusaEmpresaPix('empresa não encontrada');
  const doc = so(e.cnpj);
  if (doc.length !== 14) throw new RecusaEmpresaPix(`${e.nome} está sem CNPJ no cadastro da empresa`);
  const conf = conferirChavePix({ chave, docFornecedor: doc, favorecido });
  if (!conf || conf.tipo === 'DESCONHECIDA') throw new RecusaEmpresaPix('essa chave Pix não parece válida (CNPJ, e-mail, telefone com +55 ou chave aleatória)');
  if (conf.nivel === 'diverge') throw new RecusaEmpresaPix(`${conf.msg} — se o Pix cai em nome de outro, preencha "quem recebe"`);
  return { e, doc, chave };
}

const bancoLimpo = (b: string | null | undefined) => b?.trim().slice(0, 60) || null;

/** Guarda mais uma chave da empresa (outro banco). Não mexe na principal nem no
 *  cadastro de fornecedor — a não ser que a empresa ainda não tenha principal:
 *  aí a primeira chave já entra como principal. */
export async function adicionarChaveDaEmpresa(p: {
  usuarioId: string;
  filialId: string;
  chave: string;
  banco: string | null;
  favorecido: string | null;
}): Promise<{ principal: boolean; cadastros: number }> {
  const favorecido = p.favorecido?.trim() || null;
  const { e, chave } = await validar(p.filialId, p.chave, favorecido);
  const [tem] = await db
    .select({ id: schema.empresaPixChave.id })
    .from(schema.empresaPixChave)
    .where(and(eq(schema.empresaPixChave.filialId, e.id), eq(schema.empresaPixChave.chave, chave), isNull(schema.empresaPixChave.removidoEm)))
    .limit(1);
  if (tem) throw new RecusaEmpresaPix('essa chave já está cadastrada nessa empresa');
  const [atual] = await db.select({ c: schema.filial.pixTransfChave }).from(schema.filial).where(eq(schema.filial.id, e.id)).limit(1);
  if (!atual?.c?.trim()) {
    const r = await definirPixDaEmpresa({ usuarioId: p.usuarioId, filialId: e.id, chave, favorecido, banco: p.banco });
    return { principal: true, cadastros: r.cadastros };
  }
  await db.insert(schema.empresaPixChave).values({
    filialId: e.id,
    chave,
    banco: bancoLimpo(p.banco),
    favorecido,
    criadoPor: p.usuarioId,
  });
  return { principal: false, cadastros: 0 };
}

/** Passa uma chave já cadastrada a ser a principal (vai pro cadastro de fornecedor em todas as empresas). */
export async function tornarChavePrincipal(p: { usuarioId: string; chaveId: string }): Promise<{ filialId: string; cadastros: number }> {
  const [c] = await db
    .select()
    .from(schema.empresaPixChave)
    .where(and(eq(schema.empresaPixChave.id, p.chaveId), isNull(schema.empresaPixChave.removidoEm)))
    .limit(1);
  if (!c) throw new RecusaEmpresaPix('chave não encontrada');
  const r = await definirPixDaEmpresa({ usuarioId: p.usuarioId, filialId: c.filialId, chave: c.chave, favorecido: c.favorecido, banco: c.banco });
  return { filialId: c.filialId, cadastros: r.cadastros };
}

/** Anota/corrige o banco de uma chave. */
export async function definirBancoDaChave(p: { chaveId: string; banco: string | null }) {
  await db.update(schema.empresaPixChave).set({ banco: bancoLimpo(p.banco) }).where(eq(schema.empresaPixChave.id, p.chaveId));
}

/** Tira uma chave da lista (a principal não sai: escolha outra como principal antes). */
export async function removerChaveDaEmpresa(p: { usuarioId: string; chaveId: string }) {
  const [c] = await db
    .select({ id: schema.empresaPixChave.id, principal: schema.empresaPixChave.principal })
    .from(schema.empresaPixChave)
    .where(and(eq(schema.empresaPixChave.id, p.chaveId), isNull(schema.empresaPixChave.removidoEm)))
    .limit(1);
  if (!c) throw new RecusaEmpresaPix('chave não encontrada');
  if (c.principal) throw new RecusaEmpresaPix('essa é a chave principal: escolha outra como principal antes de remover');
  await db
    .update(schema.empresaPixChave)
    .set({ removidoEm: new Date(), removidoPor: p.usuarioId })
    .where(eq(schema.empresaPixChave.id, c.id));
}

/** Empresa dona de uma chave (pra conferir o acesso na API). */
export async function filialDaChave(chaveId: string): Promise<string | null> {
  const [c] = await db.select({ f: schema.empresaPixChave.filialId }).from(schema.empresaPixChave).where(eq(schema.empresaPixChave.id, chaveId)).limit(1);
  return c?.f ?? null;
}

/** Grava a chave autorizada da empresa e leva pra todos os cadastros dela como
 *  fornecedor (mesmo CNPJ), em qualquer empresa. Devolve quantos atualizou. */
export async function definirPixDaEmpresa(p: {
  usuarioId: string;
  filialId: string;
  chave: string;
  favorecido: string | null;
  /** banco da chave; undefined = não mexe no que já está anotado */
  banco?: string | null;
}): Promise<{ cadastros: number }> {
  const favorecido = p.favorecido?.trim() || null;
  const { e, doc, chave } = await validar(p.filialId, p.chave, favorecido);

  return db.transaction(async (tx) => {
    // lista de chaves: essa passa a ser a principal (as outras continuam guardadas)
    await tx
      .update(schema.empresaPixChave)
      .set({ principal: false })
      .where(and(eq(schema.empresaPixChave.filialId, e.id), eq(schema.empresaPixChave.principal, true)));
    const [ja] = await tx
      .select({ id: schema.empresaPixChave.id })
      .from(schema.empresaPixChave)
      .where(and(eq(schema.empresaPixChave.filialId, e.id), eq(schema.empresaPixChave.chave, chave), isNull(schema.empresaPixChave.removidoEm)))
      .limit(1);
    if (ja) {
      await tx
        .update(schema.empresaPixChave)
        .set({ principal: true, favorecido, ...(p.banco !== undefined ? { banco: bancoLimpo(p.banco) } : {}) })
        .where(eq(schema.empresaPixChave.id, ja.id));
    } else {
      await tx.insert(schema.empresaPixChave).values({
        filialId: e.id,
        chave,
        banco: bancoLimpo(p.banco),
        favorecido,
        principal: true,
        criadoPor: p.usuarioId,
      });
    }
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
