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
}): Promise<string | null> {
  const cnpjDigits = opts.emitCnpj?.replace(/\D/g, '') ?? null;
  if (!cnpjDigits) return null;

  // 1. Tenta match na filial alvo via CNPJ normalizado
  const [proprio] = await db
    .select({ id: schema.fornecedor.id })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.filialId, opts.filialId),
        sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '\D', '', 'g') = ${cnpjDigits}`,
      ),
    )
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
        sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '\D', '', 'g') = ${cnpjDigits}`,
      ),
    )
    .limit(1);
  if (!outraFilial) return null;

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
