// Notas de compra da Lelis → produtos da tela de preço (01/11/2026).
// Cada item de nota_compra_item da filial Lelis vira (ou atualiza) uma linha em
// revenda_produto. A compra mais nova manda no custo; os percentuais e o preço
// manual que o dono digitou nunca são tocados.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { filialDoCnpj, LELIS_CNPJ } from '@/lib/impostos/guia';
import { cstPisDaEntrada, tribIcmsDaEntrada } from './tributacao';

let lelisIdCache: string | null = null;
export async function lelisFilialId(): Promise<string | null> {
  if (lelisIdCache) return lelisIdCache;
  const f = await filialDoCnpj(LELIS_CNPJ);
  lelisIdCache = f?.id ?? null;
  return lelisIdCache;
}

/** GTIN de verdade (8/12/13/14 dígitos com dígito verificador certo). */
export function gtinValido(ean: string | null | undefined): string | null {
  const d = (ean ?? '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(d.length) || /^0+$/.test(d)) return null;
  const nums = d.split('').map(Number);
  const dv = nums.pop()!;
  let soma = 0;
  nums.reverse().forEach((x, i) => { soma += x * (i % 2 === 0 ? 3 : 1); });
  return (10 - (soma % 10)) % 10 === dv ? d : null;
}

/** Chave do produto na tela de preço: GTIN válido, senão fornecedor + código. */
export function chaveProduto(ean: string | null, emitCnpj: string | null, codigo: string | null, descricao: string | null): string {
  const g = gtinValido(ean);
  const cnpj = (emitCnpj ?? '').replace(/\D/g, '');
  return g ?? `F${cnpj}:${(codigo ?? descricao ?? '').slice(0, 60)}`;
}

// Interestadual pra Sergipe (Nordeste): Sul/Sudeste (menos ES) = 7%, resto = 12%.
const SUL_SUDESTE = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']);
function aliqPorUf(uf: string | null): number | null {
  if (!uf) return null;
  if (uf === 'SE') return 18;
  return SUL_SUDESTE.has(uf) ? 7 : 12;
}

interface LinhaItem {
  chave_nota: string;
  emit_cnpj: string | null;
  emit_nome: string | null;
  emit_uf: string | null;
  dia: string | null;
  codigo: string | null;
  ean: string | null;
  descricao: string | null;
  ncm: string | null;
  cest: string | null;
  unidade: string | null;
  quantidade: string | null;
  valor_total: string | null;
  valor_desconto: string | null;
  valor_frete: string | null;
  valor_ipi: string | null;
  aliquota_icms: string | null;
  cfop: string | null;
  cst_icms: string | null;
  cst_pis: string | null;
  valor_icms_st: string | null;
  valor_icms_st_ret: string | null;
}

export async function sincronizarProdutosDasNotas(filialId: string, usuario: string): Promise<{ itens: number; produtos: number }> {
  const itens = (await db.execute(sql`
    SELECT n.chave AS chave_nota, n.emit_cnpj, n.emit_nome, n.emit_uf,
           (n.data_emissao AT TIME ZONE 'America/Sao_Paulo')::date::text AS dia,
           i.codigo_produto_fornecedor AS codigo, i.ean, i.descricao, i.ncm, i.cest, i.unidade,
           i.quantidade::text, i.valor_total::text, i.valor_desconto::text, i.valor_frete::text,
           i.valor_ipi::text, i.aliquota_icms::text,
           i.cfop, i.cst_icms, i.cst_pis, i.valor_icms_st::text, i.valor_icms_st_ret::text
      FROM nota_compra_item i JOIN nota_compra n ON n.id = i.nota_compra_id
     WHERE i.filial_id = ${filialId}::uuid
     ORDER BY n.data_emissao NULLS FIRST, i.numero_item
  `)) as unknown as LinhaItem[];

  const chaves = new Set<string>();
  for (const it of itens) {
    const qtd = Number(it.quantidade) || 0;
    if (qtd <= 0) continue;
    const ean = gtinValido(it.ean);
    const chave = chaveProduto(it.ean, it.emit_cnpj, it.codigo, it.descricao);
    chaves.add(chave);
    const bruto = Number(it.valor_total) || 0;
    const desc = Number(it.valor_desconto) || 0;
    const custoUnit = (bruto - desc) / qtd;
    const pctIpi = bruto - desc > 0 ? ((Number(it.valor_ipi) || 0) / (bruto - desc)) * 100 : 0;
    const freteUnit = (Number(it.valor_frete) || 0) / qtd;
    const aliqNota = Number(it.aliquota_icms) || 0;
    const aliqOrigem = aliqNota > 0 ? aliqNota : aliqPorUf(it.emit_uf);
    const ncm = (it.ncm ?? '').replace(/\D/g, '').slice(0, 8) || null;
    const cest = (it.cest ?? '').replace(/\D/g, '').slice(0, 7) || null;
    const un = (it.unidade ?? 'UN').toUpperCase().slice(0, 6);
    const vSt = Number(it.valor_icms_st) || 0;
    const vStRet = Number(it.valor_icms_st_ret) || 0;
    const tribIcms = tribIcmsDaEntrada({ cfop: it.cfop, cstIcms: it.cst_icms, cstPis: it.cst_pis, valorIcmsSt: vSt, valorIcmsStRet: vStRet });
    const cstPisSaida = cstPisDaEntrada(it.cst_pis);
    const cfopEntrada = (it.cfop ?? '').replace(/\D/g, '').slice(0, 4) || null;
    const stUnit = vSt + vStRet > 0 ? ((vSt + vStRet) / qtd).toFixed(4) : null;

    await db.execute(sql`
      INSERT INTO revenda_produto (filial_id, chave, ean, codigo_fornecedor, fornecedor_nome, descricao, ncm, cest, unidade,
                                   custo_unit, pct_ipi, aliq_origem, frete_unit, ultima_nota_chave, ultima_compra_em, atualizado_por,
                                   trib_icms, cst_pis_saida, cfop_entrada, cst_icms_entrada, cst_pis_entrada, icms_st_unit)
      VALUES (${filialId}::uuid, ${chave}, ${ean}, ${it.codigo}, ${it.emit_nome}, ${it.descricao ?? 'SEM DESCRIÇÃO'}, ${ncm}, ${cest}, ${un},
              ${custoUnit.toFixed(4)}::numeric, ${pctIpi.toFixed(4)}::numeric, ${aliqOrigem}::numeric, ${freteUnit.toFixed(4)}::numeric,
              ${it.chave_nota}, ${it.dia}::date, ${usuario},
              ${tribIcms}, ${cstPisSaida}, ${cfopEntrada}, ${it.cst_icms}, ${it.cst_pis}, ${stUnit}::numeric)
      ON CONFLICT (filial_id, chave) DO UPDATE SET
        custo_unit = excluded.custo_unit,
        pct_ipi = excluded.pct_ipi,
        aliq_origem = excluded.aliq_origem,
        frete_unit = excluded.frete_unit,
        fornecedor_nome = excluded.fornecedor_nome,
        codigo_fornecedor = excluded.codigo_fornecedor,
        ncm = COALESCE(excluded.ncm, revenda_produto.ncm),
        cest = COALESCE(excluded.cest, revenda_produto.cest),
        ultima_nota_chave = excluded.ultima_nota_chave,
        ultima_compra_em = excluded.ultima_compra_em,
        cfop_entrada = COALESCE(excluded.cfop_entrada, revenda_produto.cfop_entrada),
        cst_icms_entrada = COALESCE(excluded.cst_icms_entrada, revenda_produto.cst_icms_entrada),
        cst_pis_entrada = COALESCE(excluded.cst_pis_entrada, revenda_produto.cst_pis_entrada),
        icms_st_unit = COALESCE(excluded.icms_st_unit, revenda_produto.icms_st_unit),
        trib_icms = CASE WHEN revenda_produto.trib_manual THEN revenda_produto.trib_icms
                         ELSE COALESCE(excluded.trib_icms, revenda_produto.trib_icms) END,
        cst_pis_saida = CASE WHEN revenda_produto.trib_manual THEN revenda_produto.cst_pis_saida
                             ELSE COALESCE(excluded.cst_pis_saida, revenda_produto.cst_pis_saida) END,
        atualizado_em = now(),
        atualizado_por = excluded.atualizado_por
      WHERE revenda_produto.ultima_compra_em IS NULL
         OR excluded.ultima_compra_em IS NULL
         OR excluded.ultima_compra_em >= revenda_produto.ultima_compra_em
    `);
  }
  return { itens: itens.length, produtos: chaves.size };
}
