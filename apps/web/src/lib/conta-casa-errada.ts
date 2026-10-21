// Trava "nota de outra casa" na conta a pagar manual (21/10/2026).
//
// Caso Prime Food: a NF-e 7167 era da Prainha Mar (destino CNPJ …0328, já
// importada lá em 29/09), mas a parcela 1 foi lançada à mão no Bar em 02/10
// com o histórico "000007167". Virou despesa em dobro e um encontro de contas
// errado. Aqui, antes de lançar, procura se o número escrito no histórico ou
// na observação é de uma NF-e do MESMO fornecedor (CNPJ) que está em outra
// casa da organização. Só avisa: quem confirma lança mesmo assim.

import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@concilia/db';

export type NotaDeOutraCasa = {
  notaId: string;
  numero: number;
  casa: string;
  valorTotal: string;
  emissao: string | null;
  fornecedor: string | null;
};

/** Números de 3 a 9 dígitos do texto, sem zeros à esquerda ("000007167" → 7167). */
function numerosDoTexto(textos: (string | null | undefined)[]): number[] {
  const nums = new Set<number>();
  for (const t of textos) {
    for (const m of (t ?? '').matchAll(/\d{3,9}/g)) {
      const n = Number(m[0]);
      if (n >= 100) nums.add(n);
    }
  }
  return [...nums].slice(0, 20);
}

export async function notaDeOutraCasa(p: {
  filialId: string;
  fornecedorId: string | null;
  textos: (string | null | undefined)[];
}): Promise<NotaDeOutraCasa | null> {
  if (!p.fornecedorId) return null;
  const numeros = numerosDoTexto(p.textos);
  if (numeros.length === 0) return null;

  const [forn] = await db
    .select({ cnpj: schema.fornecedor.cnpjOuCpf })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, p.fornecedorId))
    .limit(1);
  const cnpj = (forn?.cnpj ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14) return null;

  const [casa] = await db
    .select({ org: schema.filial.organizacaoId, cnpj: schema.filial.cnpj })
    .from(schema.filial)
    .where(eq(schema.filial.id, p.filialId))
    .limit(1);
  if (!casa) return null;

  const notas = await db
    .select({
      notaId: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      numero: schema.notaCompra.numero,
      destCnpj: schema.notaCompra.destCnpj,
      valorTotal: schema.notaCompra.valorTotal,
      emissao: schema.notaCompra.dataEmissao,
      fornecedor: schema.notaCompra.emitNome,
      casa: schema.filial.nome,
    })
    .from(schema.notaCompra)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.notaCompra.filialId))
    .where(
      and(
        eq(schema.filial.organizacaoId, casa.org),
        eq(schema.notaCompra.emitCnpj, cnpj),
        inArray(schema.notaCompra.numero, numeros),
      ),
    )
    .limit(20);

  // A nota também está nesta casa (ou foi emitida pra ela) → não é engano.
  for (const n of notas) {
    if (n.filialId === p.filialId) return null;
    if (n.destCnpj && casa.cnpj && n.destCnpj === casa.cnpj) return null;
  }
  const outra = notas.find((n) => n.filialId !== p.filialId);
  if (!outra || outra.numero == null) return null;
  return {
    notaId: outra.notaId,
    numero: outra.numero,
    casa: outra.casa,
    valorTotal: outra.valorTotal ?? '0',
    emissao: outra.emissao ? outra.emissao.toISOString() : null,
    fornecedor: outra.fornecedor,
  };
}
