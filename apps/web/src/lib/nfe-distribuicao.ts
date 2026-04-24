// Orquestra a consulta SEFAZ Distribuição DF-e pra uma filial:
//  1. Baixa o PFX do Supabase Storage
//  2. Decifra a senha
//  3. Chama consultarDistribuicao
//  4. Processa cada doc → upsert em nota_compra (quando for NFe)
//  5. Atualiza ultimoNsu no certificado
//
// Usado tanto pelo endpoint manual quanto pelo cron.

import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { decifrarSenha } from '@/lib/certificado';
import { consultarDistribuicao, UF_CODIGO } from '@/lib/sefaz-dfe';
import { parseNfeXml } from '@/lib/nfe-parser';
import { XMLParser } from 'fast-xml-parser';

export interface ResumoConsulta {
  filialId: string;
  cStat: string;
  xMotivo: string;
  ultNsuAntes: string;
  ultNsuDepois: string;
  maxNsu: string;
  docsRecebidos: number;
  nfesCompletasInseridas: number;
  nfesResumoInseridas: number;
  duplicadas: number;
  eventosIgnorados: number;
  erros: string[];
  /** Se maxNSU > ultNSU ainda há mais docs pra buscar (chame de novo) */
  temMais: boolean;
}

async function baixarPfx(path: string): Promise<Buffer> {
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from('certificados').download(path);
  if (error) throw new Error(`erro baixando pfx: ${error.message}`);
  if (!data) throw new Error('pfx nao encontrado no storage');
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

/** Parse resNFe (resumo) — dados mínimos pra cadastrar stub. */
function parseResNFe(xml: string): {
  chave: string;
  emitCnpj: string | null;
  emitNome: string | null;
  dataEmissao: string | null;
  tipoOperacao: number | null;
  valorTotal: number;
  situacao: string;
  protocolo: string | null;
  dataAutorizacao: string | null;
} | null {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });
  const p = parser.parse(xml) as Record<string, unknown>;
  const r = p.resNFe as Record<string, unknown> | undefined;
  if (!r) return null;
  const chave = String(r.chNFe ?? '').replace(/\D/g, '');
  if (!/^\d{44}$/.test(chave)) return null;

  const cSit = String(r.cSitNFe ?? '1');
  const situacao = cSit === '2' ? 'CANCELADA' : cSit === '3' ? 'DENEGADA' : 'AUTORIZADA';

  return {
    chave,
    emitCnpj: r.CNPJ ? String(r.CNPJ).replace(/\D/g, '') : null,
    emitNome: r.xNome ? String(r.xNome) : null,
    dataEmissao: r.dhEmi ? String(r.dhEmi) : null,
    tipoOperacao: r.tpNF != null ? Number(r.tpNF) : null,
    valorTotal: Number(r.vNF ?? 0) || 0,
    situacao,
    protocolo: r.nProt ? String(r.nProt) : null,
    dataAutorizacao: r.dhRecbto ? String(r.dhRecbto) : null,
  };
}

/** Dado uma NFe completa (procNFe decomprimido), faz upsert idempotente. */
async function inserirNfeCompleta(
  filialId: string,
  xml: string,
): Promise<'INSERIDA' | 'DUPLICADA' | 'ERRO'> {
  let nfe;
  try {
    nfe = parseNfeXml(xml);
  } catch {
    return 'ERRO';
  }

  const [existente] = await db
    .select({ id: schema.notaCompra.id })
    .from(schema.notaCompra)
    .where(
      and(eq(schema.notaCompra.filialId, filialId), eq(schema.notaCompra.chave, nfe.chave)),
    )
    .limit(1);
  if (existente) return 'DUPLICADA';

  let fornecedorId: string | null = null;
  if (nfe.emitCnpj) {
    const [forn] = await db
      .select({ id: schema.fornecedor.id })
      .from(schema.fornecedor)
      .where(
        and(
          eq(schema.fornecedor.filialId, filialId),
          eq(schema.fornecedor.cnpjOuCpf, nfe.emitCnpj),
        ),
      )
      .limit(1);
    fornecedorId = forn?.id ?? null;
  }

  const xmlHash = createHash('sha256').update(xml).digest('hex');

  const [nova] = await db
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
      fornecedorId,
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
      xmlHash,
      origemImportacao: 'SEFAZ_DFE',
    })
    .returning({ id: schema.notaCompra.id });

  if (nova && nfe.itens.length > 0) {
    await db.insert(schema.notaCompraItem).values(
      nfe.itens.map((it) => ({
        filialId,
        notaCompraId: nova.id,
        numeroItem: it.numeroItem,
        codigoProdutoFornecedor: it.codigoProdutoFornecedor,
        ean: it.ean,
        descricao: it.descricao,
        ncm: it.ncm,
        cest: it.cest,
        cfop: it.cfop,
        unidade: it.unidade,
        quantidade: it.quantidade != null ? String(it.quantidade) : null,
        valorUnitario: it.valorUnitario != null ? String(it.valorUnitario) : null,
        valorTotal: it.valorTotal != null ? String(it.valorTotal) : null,
        valorDesconto: it.valorDesconto != null ? String(it.valorDesconto) : null,
        valorFrete: it.valorFrete != null ? String(it.valorFrete) : null,
        valorIcms: it.valorIcms != null ? String(it.valorIcms) : null,
        aliquotaIcms: it.aliquotaIcms != null ? String(it.aliquotaIcms) : null,
        valorIpi: it.valorIpi != null ? String(it.valorIpi) : null,
        valorPis: it.valorPis != null ? String(it.valorPis) : null,
        valorCofins: it.valorCofins != null ? String(it.valorCofins) : null,
      })),
    );
  }
  return 'INSERIDA';
}

/** Insere um stub de NFe a partir do resumo (resNFe). */
async function inserirResumo(
  filialId: string,
  xml: string,
): Promise<'INSERIDA' | 'DUPLICADA' | 'ERRO'> {
  const r = parseResNFe(xml);
  if (!r) return 'ERRO';

  const [existente] = await db
    .select({ id: schema.notaCompra.id })
    .from(schema.notaCompra)
    .where(and(eq(schema.notaCompra.filialId, filialId), eq(schema.notaCompra.chave, r.chave)))
    .limit(1);
  if (existente) return 'DUPLICADA';

  let fornecedorId: string | null = null;
  if (r.emitCnpj) {
    const [forn] = await db
      .select({ id: schema.fornecedor.id })
      .from(schema.fornecedor)
      .where(
        and(
          eq(schema.fornecedor.filialId, filialId),
          eq(schema.fornecedor.cnpjOuCpf, r.emitCnpj),
        ),
      )
      .limit(1);
    fornecedorId = forn?.id ?? null;
  }

  // Extrai serie e número da chave (posições 22-25 = série, 26-34 = número)
  const serie = Number(r.chave.slice(22, 25));
  const numero = Number(r.chave.slice(25, 34));
  const modelo = Number(r.chave.slice(20, 22));

  await db.insert(schema.notaCompra).values({
    filialId,
    chave: r.chave,
    modelo,
    serie: Number.isFinite(serie) ? serie : null,
    numero: Number.isFinite(numero) ? numero : null,
    tipoOperacao: r.tipoOperacao,
    emitCnpj: r.emitCnpj,
    emitNome: r.emitNome,
    fornecedorId,
    dataEmissao: r.dataEmissao ? new Date(r.dataEmissao) : null,
    valorTotal: String(r.valorTotal),
    situacao: r.situacao,
    protocoloAutorizacao: r.protocolo,
    dataAutorizacao: r.dataAutorizacao ? new Date(r.dataAutorizacao) : null,
    origemImportacao: 'SEFAZ_DFE_RESUMO',
  });
  return 'INSERIDA';
}

/** Consulta SEFAZ DF-e pra uma filial e processa todos os docs retornados. */
export async function consultarEProcessar(opts: {
  filialId: string;
  /** Sigla UF (2 letras). Default: 'SE' (Sergipe). */
  uf?: string;
  tpAmb?: 1 | 2;
}): Promise<ResumoConsulta> {
  const uf = (opts.uf ?? 'SE').toUpperCase();
  const cUF = UF_CODIGO[uf];
  if (!cUF) throw new Error(`UF invalida: ${uf}`);

  // Busca cert ativo + CNPJ da filial
  const [row] = await db
    .select({
      certId: schema.certificadoFilial.id,
      pfxStoragePath: schema.certificadoFilial.pfxStoragePath,
      senhaCifrada: schema.certificadoFilial.senhaCifrada,
      ultimoNsu: schema.certificadoFilial.ultimoNsu,
      cnpjCertificado: schema.certificadoFilial.cnpjCertificado,
      filialCnpj: schema.filial.cnpj,
      filialId: schema.filial.id,
    })
    .from(schema.certificadoFilial)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.certificadoFilial.filialId))
    .where(
      and(
        eq(schema.certificadoFilial.filialId, opts.filialId),
        eq(schema.certificadoFilial.ativo, true),
      ),
    )
    .limit(1);

  if (!row) throw new Error('filial sem certificado A1 ativo');

  const cnpjConsulta = row.filialCnpj;
  if (!cnpjConsulta) throw new Error('filial sem CNPJ cadastrado');

  const pfxBytes = await baixarPfx(row.pfxStoragePath);
  const senhaPfx = decifrarSenha(row.senhaCifrada);

  const ultNsuAntes = row.ultimoNsu ?? '000000000000000';

  const resp = await consultarDistribuicao({
    pfxBytes,
    senhaPfx,
    cnpj: cnpjConsulta,
    cUF,
    ultimoNsu: ultNsuAntes,
    tpAmb: opts.tpAmb ?? 1,
  });

  let nfesCompletasInseridas = 0;
  let nfesResumoInseridas = 0;
  let duplicadas = 0;
  let eventosIgnorados = 0;
  const erros: string[] = [];

  for (const d of resp.docs) {
    try {
      if (d.tipo === 'NFE_COMPLETA') {
        const r = await inserirNfeCompleta(opts.filialId, d.xml);
        if (r === 'INSERIDA') nfesCompletasInseridas++;
        else if (r === 'DUPLICADA') duplicadas++;
        else erros.push(`NSU ${d.nsu}: erro parse procNFe`);
      } else if (d.tipo === 'NFE_RESUMO') {
        const r = await inserirResumo(opts.filialId, d.xml);
        if (r === 'INSERIDA') nfesResumoInseridas++;
        else if (r === 'DUPLICADA') duplicadas++;
        else erros.push(`NSU ${d.nsu}: erro parse resNFe`);
      } else {
        // eventos (completos ou resumos) ignorados na v1
        eventosIgnorados++;
      }
    } catch (e) {
      erros.push(`NSU ${d.nsu}: ${(e as Error).message}`);
    }
  }

  // Atualiza checkpoint mesmo quando cStat != 138 — SEFAZ sempre devolve ultNSU válido.
  // (se houver ERRO sem ultNSU, volta o antes)
  const ultNsuDepois = resp.ultNSU && resp.ultNSU !== '000000000000000' ? resp.ultNSU : ultNsuAntes;

  await db
    .update(schema.certificadoFilial)
    .set({ ultimoNsu: ultNsuDepois, ultimaConsultaSefaz: new Date() })
    .where(eq(schema.certificadoFilial.id, row.certId));

  return {
    filialId: opts.filialId,
    cStat: resp.cStat,
    xMotivo: resp.xMotivo,
    ultNsuAntes,
    ultNsuDepois,
    maxNsu: resp.maxNSU,
    docsRecebidos: resp.docs.length,
    nfesCompletasInseridas,
    nfesResumoInseridas,
    duplicadas,
    eventosIgnorados,
    erros,
    temMais: resp.maxNSU > ultNsuDepois,
  };
}
