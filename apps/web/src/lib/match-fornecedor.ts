// Resolve fornecedor pra uma NFe que chegou pra uma filial.
//
// Estrategia:
//   1. Tenta match na propria filial via CNPJ normalizado (digits only)
//   2. Se nao acha, busca em outras filiais da MESMA organizacao
//   3. Se acha em outra filial, replica o cadastro pra filial alvo
//      (codigo_externo NULL pra ser tratado como criado-na-nuvem) e retorna
//      o id do novo registro
//
// Quando o agente local sincronizar do Consumer, vai fazer match por CNPJ
// e atualizar este registro com o codigo_externo correto.

import { db, schema } from '@concilia/db';
import { and, eq, sql, ne, isNull } from 'drizzle-orm';

export async function resolverFornecedorParaNota(opts: {
  filialId: string;
  emitCnpj: string | null;
  emitNome?: string | null;
  emitFantasia?: string | null;
  emitIe?: string | null;
  emitUf?: string | null;
  emitCidade?: string | null;
}): Promise<string | null> {
  const cnpjDigits = opts.emitCnpj?.replace(/\D/g, '') ?? null;
  if (!cnpjDigits) return null;

  // Pra CNPJ (14 digits), match e' por cnpj_raiz (8 primeiros) — mesma empresa
  // em filiais diferentes tem cnpj_raiz igual. Pra CPF (11 digits), match e
  // pelo CPF inteiro (nao tem hierarquia).
  const ehCnpj = cnpjDigits.length === 14;
  const cnpjRaiz = ehCnpj ? cnpjDigits.slice(0, 8) : cnpjDigits;
  const matchExpr = ehCnpj
    ? sql`left(regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '\D', '', 'g'), 8) = ${cnpjRaiz}`
    : sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '\D', '', 'g') = ${cnpjDigits}`;

  // 1. Tenta match na filial alvo via cnpj_raiz (ou CPF inteiro)
  const [proprio] = await db
    .select({ id: schema.fornecedor.id })
    .from(schema.fornecedor)
    .where(and(eq(schema.fornecedor.filialId, opts.filialId), matchExpr))
    .limit(1);
  if (proprio) return proprio.id;

  // 2. Pega organizacao da filial alvo
  const [filialAlvo] = await db
    .select({ organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, opts.filialId))
    .limit(1);
  if (!filialAlvo?.organizacaoId) return null;

  // 3. Busca em qualquer filial da mesma org
  const [outraFilial] = await db
    .select({
      id: schema.fornecedor.id,
      cnpjOuCpf: schema.fornecedor.cnpjOuCpf,
      nome: schema.fornecedor.nome,
      razaoSocial: schema.fornecedor.razaoSocial,
      endereco: schema.fornecedor.endereco,
      numero: schema.fornecedor.numero,
      complemento: schema.fornecedor.complemento,
      bairro: schema.fornecedor.bairro,
      cidade: schema.fornecedor.cidade,
      uf: schema.fornecedor.uf,
      cep: schema.fornecedor.cep,
      email: schema.fornecedor.email,
      fonePrincipal: schema.fornecedor.fonePrincipal,
      foneSecundario: schema.fornecedor.foneSecundario,
      rgOuIe: schema.fornecedor.rgOuIe,
      ativoCompras: schema.fornecedor.ativoCompras,
      categoriaCompras: schema.fornecedor.categoriaCompras,
    })
    .from(schema.fornecedor)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.fornecedor.filialId))
    .where(
      and(
        eq(schema.filial.organizacaoId, filialAlvo.organizacaoId),
        ne(schema.fornecedor.filialId, opts.filialId),
        isNull(schema.fornecedor.dataDelete),
        matchExpr,
      ),
    )
    .limit(1);

  if (outraFilial) {
    // 4. Replica pra filial alvo (codigo_externo NULL = criado na nuvem)
    const [novo] = await db
      .insert(schema.fornecedor)
      .values({
        filialId: opts.filialId,
        codigoExterno: null,
        cnpjOuCpf: outraFilial.cnpjOuCpf,
        nome: outraFilial.nome,
        razaoSocial: outraFilial.razaoSocial,
        endereco: outraFilial.endereco,
        numero: outraFilial.numero,
        complemento: outraFilial.complemento,
        bairro: outraFilial.bairro,
        cidade: outraFilial.cidade,
        uf: outraFilial.uf,
        cep: outraFilial.cep,
        email: outraFilial.email,
        fonePrincipal: outraFilial.fonePrincipal,
        foneSecundario: outraFilial.foneSecundario,
        rgOuIe: outraFilial.rgOuIe,
        ativoCompras: outraFilial.ativoCompras,
        categoriaCompras: outraFilial.categoriaCompras,
      })
      .returning({ id: schema.fornecedor.id });
    return novo?.id ?? null;
  }

  // 5. Ultimo fallback: cria fornecedor com dados do proprio XML.
  //    Nada existe em nenhum lugar da organizacao, entao e um fornecedor novo.
  //    Quando o agente local sincronizar com o Consumer, vai fazer match por
  //    CNPJ e atualizar codigo_externo.
  if (!opts.emitNome) return null;
  const [novo] = await db
    .insert(schema.fornecedor)
    .values({
      filialId: opts.filialId,
      codigoExterno: null,
      cnpjOuCpf: cnpjDigits,
      nome: opts.emitFantasia ?? opts.emitNome,
      razaoSocial: opts.emitNome,
      cidade: opts.emitCidade ?? null,
      uf: opts.emitUf ?? null,
      rgOuIe: opts.emitIe ?? null,
      ativoCompras: true,
      categoriaCompras: null,
    })
    .returning({ id: schema.fornecedor.id });
  return novo?.id ?? null;
}
