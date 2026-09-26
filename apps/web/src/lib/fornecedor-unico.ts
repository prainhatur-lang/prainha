// CADASTRO ÚNICO DE FORNECEDOR entre as casas.
//
// Cada casa continua com a sua linha em `fornecedor` — o Consumer de cada loja
// tem o próprio código e o sync faz upsert por (filial, codigo_externo). O que
// une as linhas da mesma empresa é o `grupo_economico_id` (ou, na falta dele,
// o CNPJ raiz / CPF). Em cima disso:
//   · editar contato/categoria/pedido mínimo numa casa vale nas outras
//     (propagarParaIrmaos);
//   · a cotação e a sugestão enxergam os fornecedores das OUTRAS casas
//     (fornecedoresDeOutrasCasas) e, ao convocar um deles, a linha da casa é
//     criada/reativada na hora (garantirFornecedorNaFilial).
// Caso que motivou: Marcelino Pescados existia no Bar e na Tabuará e não
// aparecia na Prainha Mar (26/09/2026).

import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/** Dígitos do CNPJ/CPF → chave da empresa (raiz do CNPJ, CPF inteiro). */
export function chaveDocumento(doc: string | null | undefined): string | null {
  const d = (doc ?? '').replace(/\D/g, '');
  if (d.length === 14) return 'c' + d.slice(0, 8);
  if (d.length === 11) return 'p' + d;
  return null;
}

/** Mesma chave, em SQL, sobre uma coluna de CNPJ/CPF. */
const chaveDocSql = (col: unknown) => sql`CASE
  WHEN length(regexp_replace(coalesce(${col}, ''), '\\D', '', 'g')) = 14
    THEN 'c' || left(regexp_replace(${col}, '\\D', '', 'g'), 8)
  WHEN length(regexp_replace(coalesce(${col}, ''), '\\D', '', 'g')) = 11
    THEN 'p' || regexp_replace(${col}, '\\D', '', 'g')
END`;

const naoExcluido = sql`${schema.fornecedor.dataDelete} IS NULL
  AND coalesce(${schema.fornecedor.nome}, '') NOT ILIKE '%excluído%'
  AND coalesce(${schema.fornecedor.nome}, '') NOT ILIKE '%excluido%'`;

async function orgDaFilial(exec: Exec, filialId: string): Promise<string | null> {
  const [f] = await exec
    .select({ org: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  return f?.org ?? null;
}

/** Linhas da MESMA empresa nas casas da organização (inclui a própria). */
export async function irmaosDoFornecedor(fornecedorId: string, exec: Exec = db): Promise<string[]> {
  const [f] = await exec
    .select({
      id: schema.fornecedor.id,
      filialId: schema.fornecedor.filialId,
      grupo: schema.fornecedor.grupoEconomicoId,
      doc: schema.fornecedor.cnpjOuCpf,
    })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, fornecedorId))
    .limit(1);
  if (!f) return [];
  const chave = chaveDocumento(f.doc);
  if (!f.grupo && !chave) return [f.id];
  const org = await orgDaFilial(exec, f.filialId);
  if (!org) return [f.id];
  const rows = await exec
    .select({ id: schema.fornecedor.id })
    .from(schema.fornecedor)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.fornecedor.filialId))
    .where(
      and(
        eq(schema.filial.organizacaoId, org),
        sql`${schema.fornecedor.dataDelete} IS NULL`,
        sql`(${f.grupo ? sql`${schema.fornecedor.grupoEconomicoId} = ${f.grupo}` : sql`false`}
          OR ${chave ? sql`${chaveDocSql(schema.fornecedor.cnpjOuCpf)} = ${chave}` : sql`false`})`,
      ),
    );
  const ids = new Set(rows.map((r) => r.id));
  ids.add(f.id);
  return [...ids];
}

/** Campos que são da EMPRESA (e não da casa): editou numa, vale nas outras. */
export type CamposCompartilhados = Partial<
  Pick<
    typeof schema.fornecedor.$inferInsert,
    'nome' | 'email' | 'foneWhatsapp' | 'categoriaCompras' | 'valorPedidoMinimo' | 'ativoCompras' | 'geral'
  >
>;

/** Replica a edição nas linhas irmãs das outras casas. Devolve quantas mudaram. */
export async function propagarParaIrmaos(
  fornecedorId: string,
  campos: CamposCompartilhados,
  exec: Exec = db,
): Promise<number> {
  const set: CamposCompartilhados = {};
  for (const k of ['nome', 'email', 'foneWhatsapp', 'categoriaCompras', 'valorPedidoMinimo', 'ativoCompras', 'geral'] as const) {
    if (k in campos) (set as Record<string, unknown>)[k] = campos[k];
  }
  if (Object.keys(set).length === 0) return 0;
  const irmaos = (await irmaosDoFornecedor(fornecedorId, exec)).filter((id) => id !== fornecedorId);
  if (irmaos.length === 0) return 0;
  const r = await exec
    .update(schema.fornecedor)
    .set(set)
    .where(inArray(schema.fornecedor.id, irmaos))
    .returning({ id: schema.fornecedor.id });
  return r.length;
}

/** Garante que o fornecedor tem grupo; cria e liga as linhas irmãs por
 *  documento se ainda não tiver. Devolve o id do grupo. */
async function garantirGrupo(
  exec: Exec,
  f: { id: string; grupo: string | null; nome: string | null; doc: string | null },
  org: string,
): Promise<string> {
  if (f.grupo) return f.grupo;
  const chave = chaveDocumento(f.doc);
  const [g] = await exec
    .insert(schema.grupoEconomico)
    .values({
      organizacaoId: org,
      nome: (f.nome ?? '(sem nome)').slice(0, 200),
      cnpjRaiz: chave?.startsWith('c') ? chave.slice(1) : null,
    })
    // Nome é único no grupo: mesmo nome = mesma empresa, reaproveita.
    .onConflictDoUpdate({
      target: [schema.grupoEconomico.organizacaoId, schema.grupoEconomico.nome],
      set: { atualizadoEm: new Date() },
    })
    .returning({ id: schema.grupoEconomico.id });
  const irmaos = await irmaosDoFornecedor(f.id, exec);
  await exec
    .update(schema.fornecedor)
    .set({ grupoEconomicoId: g.id })
    .where(and(inArray(schema.fornecedor.id, irmaos), sql`${schema.fornecedor.grupoEconomicoId} IS NULL`));
  return g.id;
}

/** Devolve o id do fornecedor NA CASA `filialId`: o próprio, a linha irmã que
 *  já existe lá (reativada pra compras) ou uma cópia nova (codigo_externo NULL
 *  = criada na nuvem; o sync casa pelo CNPJ se o Consumer da loja tiver). */
export async function garantirFornecedorNaFilial(
  fornecedorId: string,
  filialId: string,
  exec: Exec = db,
): Promise<string> {
  const [src] = await exec
    .select()
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, fornecedorId))
    .limit(1);
  if (!src) throw new Error('fornecedor não encontrado');
  if (src.filialId === filialId) return src.id;

  const [orgSrc, orgAlvo] = await Promise.all([orgDaFilial(exec, src.filialId), orgDaFilial(exec, filialId)]);
  if (!orgSrc || orgSrc !== orgAlvo) throw new Error('fornecedor de outra organização');

  const grupo = await garantirGrupo(
    exec,
    { id: src.id, grupo: src.grupoEconomicoId, nome: src.nome, doc: src.cnpjOuCpf },
    orgSrc,
  );
  const chave = chaveDocumento(src.cnpjOuCpf);

  // Já existe na casa? (mesmo grupo, mesmo documento, ou — sem documento —
  // mesmo nome). Prefere a que já está ativa pra compras.
  const [existente] = await exec
    .select({ id: schema.fornecedor.id })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.filialId, filialId),
        naoExcluido,
        sql`(${schema.fornecedor.grupoEconomicoId} = ${grupo}
          OR ${chave ? sql`${chaveDocSql(schema.fornecedor.cnpjOuCpf)} = ${chave}` : sql`false`}
          OR (${chave ? sql`false` : sql`true`}
              AND upper(trim(${schema.fornecedor.nome})) = upper(trim(${src.nome ?? ''}))))`,
      ),
    )
    .orderBy(sql`${schema.fornecedor.ativoCompras} DESC`, sql`${schema.fornecedor.codigoExterno} IS NULL`)
    .limit(1);

  let destinoId: string;
  if (existente) {
    await exec
      .update(schema.fornecedor)
      .set({
        grupoEconomicoId: grupo,
        ativoCompras: true,
        foneWhatsapp: sql`coalesce(nullif(${schema.fornecedor.foneWhatsapp}, ''), ${src.foneWhatsapp})`,
        email: sql`coalesce(nullif(${schema.fornecedor.email}, ''), ${src.email})`,
        categoriaCompras: sql`coalesce(${schema.fornecedor.categoriaCompras}, ${src.categoriaCompras})`,
        valorPedidoMinimo: sql`coalesce(${schema.fornecedor.valorPedidoMinimo}, ${src.valorPedidoMinimo})`,
        geral: sql`${schema.fornecedor.geral} OR ${src.geral}`,
      })
      .where(eq(schema.fornecedor.id, existente.id));
    destinoId = existente.id;
  } else {
    const [novo] = await exec
      .insert(schema.fornecedor)
      .values({
        filialId,
        codigoExterno: null,
        cnpjOuCpf: src.cnpjOuCpf,
        nome: src.nome,
        razaoSocial: src.razaoSocial,
        endereco: src.endereco,
        numero: src.numero,
        complemento: src.complemento,
        bairro: src.bairro,
        cidade: src.cidade,
        uf: src.uf,
        cep: src.cep,
        email: src.email,
        fonePrincipal: src.fonePrincipal,
        foneWhatsapp: src.foneWhatsapp,
        foneSecundario: src.foneSecundario,
        rgOuIe: src.rgOuIe,
        ativoCompras: true,
        geral: src.geral,
        categoriaCompras: src.categoriaCompras,
        valorPedidoMinimo: src.valorPedidoMinimo,
        grupoEconomicoId: grupo,
      })
      .returning({ id: schema.fornecedor.id });
    destinoId = novo.id;
  }

  // O vendedor é do grupo (não da casa): quem atende na origem atende aqui.
  await exec.execute(sql`
    INSERT INTO vendedor_fornecedor (vendedor_id, fornecedor_id, principal)
    SELECT vendedor_id, ${destinoId}, principal FROM vendedor_fornecedor
     WHERE fornecedor_id = ${src.id}
    ON CONFLICT DO NOTHING`);

  return destinoId;
}

export interface FornecedorOutraCasa {
  id: string;
  nome: string | null;
  categoria: string | null;
  valorPedidoMinimo: string | null;
  cnpjOuCpf: string | null;
  fone: string | null;
  geral: boolean;
  casa: string;
}

/** Fornecedores de compras das OUTRAS casas que esta casa ainda não tem ativo
 *  (uma linha por empresa — a que tem WhatsApp primeiro). */
export async function fornecedoresDeOutrasCasas(filialId: string): Promise<FornecedorOutraCasa[]> {
  const rows = await db.execute(sql`
    WITH org AS (SELECT organizacao_id FROM filial WHERE id = ${filialId}),
    f AS (
      SELECT fo.*, fi.nome AS casa,
        coalesce(fo.grupo_economico_id::text, ${chaveDocSql(sql`fo.cnpj_ou_cpf`)}, 'i' || fo.id::text) AS chave,
        coalesce(
          (SELECT v.whatsapp FROM vendedor_fornecedor vf JOIN vendedor v ON v.id = vf.vendedor_id
            WHERE vf.fornecedor_id = fo.id AND v.ativo AND coalesce(v.whatsapp, '') <> ''
            ORDER BY vf.principal DESC, v.atualizado_em DESC LIMIT 1),
          nullif(fo.fone_whatsapp, ''), nullif(fo.fone_principal, '')) AS fone
      FROM fornecedor fo JOIN filial fi ON fi.id = fo.filial_id
      WHERE fi.organizacao_id = (SELECT organizacao_id FROM org)
        AND fo.data_delete IS NULL
        AND coalesce(fo.nome, '') NOT ILIKE '%excluído%'
        AND coalesce(fo.nome, '') NOT ILIKE '%excluido%'
    ),
    aqui AS (SELECT chave, upper(trim(nome)) AS nome FROM f WHERE filial_id = ${filialId} AND ativo_compras)
    SELECT DISTINCT ON (chave)
      id::text, nome, categoria_compras AS categoria, valor_pedido_minimo::text AS valor_pedido_minimo,
      cnpj_ou_cpf, fone, geral, casa
    FROM f
    WHERE filial_id <> ${filialId} AND ativo_compras
      AND chave NOT IN (SELECT chave FROM aqui)
      AND upper(trim(coalesce(nome, ''))) NOT IN (SELECT coalesce(nome, '') FROM aqui)
    ORDER BY chave, (fone IS NOT NULL) DESC, (categoria_compras IS NOT NULL) DESC, sincronizado_em DESC
  `);
  return (rows as unknown as Array<Record<string, unknown>>)
    .map((r) => ({
      id: String(r.id),
      nome: (r.nome as string | null) ?? null,
      categoria: (r.categoria as string | null) ?? null,
      valorPedidoMinimo: (r.valor_pedido_minimo as string | null) ?? null,
      cnpjOuCpf: (r.cnpj_ou_cpf as string | null) ?? null,
      fone: (r.fone as string | null) ?? null,
      geral: Boolean(r.geral),
      casa: String(r.casa),
    }))
    .sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'));
}

/** Pra cada fornecedor da casa: em quais OUTRAS casas a mesma empresa existe. */
export async function outrasCasasDe(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const rows = await db.execute(sql`
    WITH base AS (
      SELECT fo.id, fo.filial_id, fi.organizacao_id, fo.grupo_economico_id AS g,
             ${chaveDocSql(sql`fo.cnpj_ou_cpf`)} AS c
        FROM fornecedor fo JOIN filial fi ON fi.id = fo.filial_id
       WHERE fo.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
    )
    SELECT b.id::text AS id, array_agg(DISTINCT fi.nome) AS casas
      FROM base b
      JOIN fornecedor o ON o.filial_id <> b.filial_id AND o.data_delete IS NULL
       AND coalesce(o.nome, '') NOT ILIKE '%excluído%' AND coalesce(o.nome, '') NOT ILIKE '%excluido%'
       AND ((b.g IS NOT NULL AND o.grupo_economico_id = b.g)
         OR (b.c IS NOT NULL AND ${chaveDocSql(sql`o.cnpj_ou_cpf`)} = b.c))
      JOIN filial fi ON fi.id = o.filial_id AND fi.organizacao_id = b.organizacao_id
     GROUP BY b.id
  `);
  for (const r of rows as unknown as Array<{ id: string; casas: string[] }>) out.set(r.id, r.casas);
  return out;
}

