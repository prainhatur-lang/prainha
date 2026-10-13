// Importa uma pasta de XML de NF-e pras notas de entrada (nota_compra) de uma
// casa — o mesmo que POST /api/notas/upload faz arquivo por arquivo: cabeçalho,
// itens e duplicatas, origem 'UPLOAD'. Feito pras notas do Mercado Livre que o
// dono mandou em 12/10/2026 (12 zips, set/2025 a ago/2026).
//
// Pula: XML que é evento (cancelamento), nota cancelada por evento na mesma
// pasta, chave que já existe em qualquer casa e nota cujo destinatário não é o
// CNPJ da casa. Sem --gravar só mostra o que faria.
//
//   npx tsx --env-file=../../.env scripts/importar-notas-xml.ts <pasta> <filialId> [--gravar]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { parseNfeXml, type NfeParseada } from '../src/lib/nfe-parser';

function xmlsDe(pasta: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const p = join(pasta, nome);
    if (statSync(p).isDirectory()) out.push(...xmlsDe(p));
    else if (nome.toLowerCase().endsWith('.xml')) out.push(p);
  }
  return out.sort();
}

const s = (n: number | null) => (n !== null ? String(n) : null);

async function main() {
  const [pasta, filialId] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const gravar = process.argv.includes('--gravar');
  if (!pasta || !filialId || !/^[0-9a-f-]{36}$/i.test(filialId)) {
    console.error('uso: importar-notas-xml.ts <pasta> <filialId> [--gravar]');
    process.exit(1);
  }
  const [filial] = await db
    .select({ nome: schema.filial.nome, cnpj: schema.filial.cnpj })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  if (!filial) throw new Error('filial não encontrada');

  const canceladas = new Set<string>();
  const notas: { arquivo: string; xml: string; nfe: NfeParseada }[] = [];
  let ilegiveis = 0;
  for (const arquivo of xmlsDe(pasta)) {
    const xml = readFileSync(arquivo, 'utf8');
    if (/<procEventoNFe|<evento[\s>]/.test(xml)) {
      if (/<tpEvento>110111<\/tpEvento>/.test(xml)) {
        const ch = xml.match(/<chNFe>(\d{44})<\/chNFe>/)?.[1];
        if (ch) canceladas.add(ch);
      }
      continue;
    }
    try {
      notas.push({ arquivo, xml, nfe: parseNfeXml(xml) });
    } catch (e) {
      ilegiveis++;
      console.log(`não li ${arquivo}: ${(e as Error).message}`);
    }
  }

  const jaTem = new Set<string>();
  const chaves = [...new Set(notas.map((n) => n.nfe.chave))];
  for (let i = 0; i < chaves.length; i += 200) {
    const r = await db
      .select({ chave: schema.notaCompra.chave })
      .from(schema.notaCompra)
      .where(inArray(schema.notaCompra.chave, chaves.slice(i, i + 200)));
    for (const x of r) if (x.chave) jaTem.add(x.chave);
  }

  let novas = 0;
  let total = 0;
  let puladasCanc = 0;
  let puladasTem = 0;
  let puladasDest = 0;
  for (const { xml, nfe } of notas) {
    if (canceladas.has(nfe.chave) || nfe.situacao === 'CANCELADA') { puladasCanc++; continue; }
    if (jaTem.has(nfe.chave)) { puladasTem++; continue; }
    if (nfe.destCnpj !== filial.cnpj) { puladasDest++; continue; }
    jaTem.add(nfe.chave);
    novas++;
    total += nfe.valorTotal;
    if (!gravar) continue;

    const [fornDaCasa] = nfe.emitCnpj
      ? await db
          .select({ id: schema.fornecedor.id })
          .from(schema.fornecedor)
          .where(and(eq(schema.fornecedor.filialId, filialId), eq(schema.fornecedor.cnpjOuCpf, nfe.emitCnpj)))
          .limit(1)
      : [];

    await db.transaction(async (tx) => {
      const [nova] = await tx
        .insert(schema.notaCompra)
        .values({
          filialId,
          chave: nfe.chave,
          modelo: nfe.modelo,
          serie: nfe.serie,
          numero: nfe.numero,
          tipoOperacao: nfe.tipoOperacao,
          naturezaOperacao: nfe.naturezaOperacao,
          emitCnpj: nfe.emitCnpj,
          emitNome: nfe.emitNome,
          emitFantasia: nfe.emitFantasia,
          emitIe: nfe.emitIe,
          emitUf: nfe.emitUf,
          emitCidade: nfe.emitCidade,
          fornecedorId: fornDaCasa?.id ?? null,
          destCnpj: nfe.destCnpj,
          destNome: nfe.destNome,
          dataEmissao: nfe.dataEmissao ? new Date(nfe.dataEmissao) : null,
          dataEntrada: nfe.dataEntrada ? new Date(nfe.dataEntrada) : null,
          valorTotal: String(nfe.valorTotal),
          valorProdutos: String(nfe.valorProdutos),
          valorFrete: String(nfe.valorFrete),
          valorSeguro: String(nfe.valorSeguro),
          valorDesconto: String(nfe.valorDesconto),
          valorOutros: String(nfe.valorOutros),
          valorIcms: String(nfe.valorIcms),
          valorIcmsSt: String(nfe.valorIcmsSt),
          valorIpi: String(nfe.valorIpi),
          valorPis: String(nfe.valorPis),
          valorCofins: String(nfe.valorCofins),
          situacao: nfe.situacao,
          protocoloAutorizacao: nfe.protocoloAutorizacao,
          dataAutorizacao: nfe.dataAutorizacao ? new Date(nfe.dataAutorizacao) : null,
          xmlHash: createHash('sha256').update(xml).digest('hex'),
          origemImportacao: 'UPLOAD',
        })
        .returning({ id: schema.notaCompra.id });
      const notaCompraId = nova!.id;

      if (nfe.itens.length > 0) {
        await tx.insert(schema.notaCompraItem).values(
          nfe.itens.map((it) => ({
            filialId,
            notaCompraId,
            numeroItem: it.numeroItem,
            codigoProdutoFornecedor: it.codigoProdutoFornecedor,
            ean: it.ean,
            descricao: it.descricao,
            ncm: it.ncm,
            cest: it.cest,
            cfop: it.cfop,
            unidade: it.unidade,
            quantidade: s(it.quantidade),
            valorUnitario: s(it.valorUnitario),
            valorTotal: s(it.valorTotal),
            valorDesconto: s(it.valorDesconto),
            valorFrete: s(it.valorFrete),
            valorIcms: s(it.valorIcms),
            aliquotaIcms: s(it.aliquotaIcms),
            valorIpi: s(it.valorIpi),
            valorPis: s(it.valorPis),
            valorCofins: s(it.valorCofins),
          })),
        );
      }
      const dups = nfe.duplicatas
        .filter((d) => d.vencimento != null && d.valor > 0)
        .map((d) => ({
          filialId,
          notaCompraId,
          numero: d.numero,
          dataVencimento: d.vencimento as string,
          valor: String(d.valor),
        }));
      if (dups.length > 0) await tx.insert(schema.notaCompraDuplicata).values(dups);
    });
  }

  console.log(
    `${filial.nome}: ${notas.length} notas lidas — ${gravar ? 'gravadas' : 'gravaria'} ${novas} (R$ ${total.toFixed(2)}); ` +
      `já existiam ${puladasTem}, canceladas ${puladasCanc}, outro destinatário ${puladasDest}, ilegíveis ${ilegiveis}.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
