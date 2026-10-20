// Papel enviado no "📸 Pedido sem nota" que na verdade é DANFE (NF-e impressa).
// Até 20/10/2026 virava pedido sem nota e duplicava a NF-e que a SEFAZ já tinha
// trazido (Mar: 9 notas num dia, 2 com estoque e conta em dobro). Agora a rota
// procura a NF-e: pela chave de 44 dígitos e, se a IA não leu a chave, pelo
// CNPJ do emitente + número da nota. Não achou aqui → busca a chave na SEFAZ.
// Só quando nada disso acha a nota é que segue o caminho antigo (pedido sem nota).

import { db, schema } from '@concilia/db';
import { and, eq, ne, notLike, sql } from 'drizzle-orm';
import { chaveNfeValida, importarPorChave } from '@/lib/nfe-distribuicao';

export interface NfeDoPapel {
  id: string;
  numero: number | null;
  emitNome: string | null;
  valorTotal: number;
  /** a nota só tem o resumo da SEFAZ (sem itens) — o XML vem depois */
  resumo: boolean;
  /** já deu entrada no estoque ou já tem conta a pagar */
  jaLancada: boolean;
  /** como a nota foi achada */
  por: 'chave' | 'cnpj+numero';
  /** a SEFAZ foi consultada agora (status de importarPorChave) */
  importacao: string | null;
}

async function porChave(filialId: string, chave: string) {
  const [n] = await db
    .select({ id: schema.notaCompra.id })
    .from(schema.notaCompra)
    .where(and(eq(schema.notaCompra.filialId, filialId), eq(schema.notaCompra.chave, chave)))
    .limit(1);
  return n?.id ?? null;
}

async function porCnpjNumero(filialId: string, cnpj: string, numero: number) {
  const [n] = await db
    .select({ id: schema.notaCompra.id })
    .from(schema.notaCompra)
    .where(
      and(
        eq(schema.notaCompra.filialId, filialId),
        eq(schema.notaCompra.emitCnpj, cnpj),
        eq(schema.notaCompra.numero, numero),
        notLike(schema.notaCompra.chave, 'SN%'),
        ne(schema.notaCompra.origemImportacao, 'PEDIDO_FOTO'),
      ),
    )
    .orderBy(schema.notaCompra.criadoEm)
    .limit(1);
  return n?.id ?? null;
}

async function detalhar(id: string, por: NfeDoPapel['por'], importacao: string | null): Promise<NfeDoPapel | null> {
  const [n] = await db
    .select({
      id: schema.notaCompra.id,
      numero: schema.notaCompra.numero,
      emitNome: schema.notaCompra.emitNome,
      valorTotal: schema.notaCompra.valorTotal,
      origem: schema.notaCompra.origemImportacao,
      jaLancada: sql<boolean>`(
        exists (select 1 from movimento_estoque m join nota_compra_item i on i.id = m.nota_compra_item_id
                 where i.nota_compra_id = ${schema.notaCompra.id})
        or exists (select 1 from conta_pagar c where c.nota_compra_id = ${schema.notaCompra.id}))`,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  if (!n) return null;
  return {
    id: n.id,
    numero: n.numero,
    emitNome: n.emitNome,
    valorTotal: Number(n.valorTotal ?? 0),
    resumo: (n.origem ?? '').startsWith('SEFAZ_DFE_RESUMO'),
    jaLancada: Boolean(n.jaLancada),
    por,
    importacao,
  };
}

/** Acha a NF-e de verdade do papel. null = não é DANFE ou a nota não existe
 *  em lugar nenhum (aí a rota segue como pedido sem nota). */
export async function acharNfeDoPapel(opts: {
  filialId: string;
  chave: string | null;
  fornecedorCnpj: string | null;
  numero: string | null;
  /** total lido no papel — sem chave, só aceita a NF-e se o valor bater
   *  (romaneio do fornecedor pode ter o mesmo número de uma NF dele) */
  total?: number | null;
}): Promise<NfeDoPapel | null> {
  const chave = opts.chave && chaveNfeValida(opts.chave) ? opts.chave : null;
  if (chave) {
    let id = await porChave(opts.filialId, chave);
    let importacao: string | null = null;
    if (!id) {
      try {
        const r = await importarPorChave({ filialId: opts.filialId, chave });
        importacao = `${r.status}: ${r.motivo}`;
      } catch (e) {
        importacao = `erro: ${(e as Error).message}`;
      }
      id = await porChave(opts.filialId, chave);
    }
    if (id) return detalhar(id, 'chave', importacao);
  }
  // Sem chave lida (foto torta, chave cortada): CNPJ + número da NF.
  const cnpj = (opts.fornecedorCnpj ?? '').replace(/\D/g, '');
  const numero = Number(String(opts.numero ?? '').replace(/\D/g, ''));
  if (cnpj.length === 14 && Number.isInteger(numero) && numero > 0 && numero < 2_000_000_000) {
    const id = await porCnpjNumero(opts.filialId, cnpj, numero);
    const total = Number(opts.total ?? NaN);
    if (id && Number.isFinite(total) && total > 0) {
      const nfe = await detalhar(id, 'cnpj+numero', null);
      if (nfe && Math.abs(nfe.valorTotal - total) <= Math.max(1, nfe.valorTotal * 0.02)) return nfe;
    }
  }
  return null;
}

/** O XML da SEFAZ muitas vezes vem sem duplicata (boleto à parte): grava o
 *  vencimento lido no papel/boleto como parcela da NF-e, pra conta a pagar
 *  sair com a data certa no "Lançar". Só quando a nota ainda não tem parcela,
 *  não foi lançada e a soma fecha com o total da nota. */
export async function gravarVencimentosDaNfe(
  nfe: NfeDoPapel,
  filialId: string,
  vencimentos: Array<{ data: string; valor: number }>,
): Promise<Array<{ data: string; valor: number }>> {
  if (nfe.jaLancada || nfe.resumo || !vencimentos.length || !(nfe.valorTotal > 0)) return [];
  const soma = vencimentos.reduce((s, v) => s + v.valor, 0);
  if (Math.abs(soma - nfe.valorTotal) > 0.05) return [];
  const [tem] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notaCompraDuplicata)
    .where(eq(schema.notaCompraDuplicata.notaCompraId, nfe.id));
  if (Number(tem?.n ?? 0) > 0) return [];
  await db.insert(schema.notaCompraDuplicata).values(
    vencimentos.map((v, i) => ({
      filialId,
      notaCompraId: nfe.id,
      numero: `BOL${i + 1}`,
      dataVencimento: v.data,
      valor: v.valor.toFixed(2),
    })),
  );
  return vencimentos;
}
