// Orquestra a consulta SEFAZ Distribuição DF-e pra uma filial:
//  1. Baixa o PFX do Supabase Storage
//  2. Decifra a senha
//  3. Chama consultarDistribuicao
//  4. Processa cada doc → upsert em nota_compra (quando for NFe)
//  5. Atualiza ultimoNsu no certificado
//
// Usado tanto pelo endpoint manual quanto pelo cron.

import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { decifrarSenha } from '@/lib/certificado';
import { findActiveCertForFilial, atualizarNsu } from '@/lib/certificado-resolver';
import { resolverFornecedorParaNota } from '@/lib/match-fornecedor';
import { tentarMatchPedidoComNota } from '@/lib/match-pedido-nf';
import { consultarDistribuicao, consultarPorChave, UF_CODIGO } from '@/lib/sefaz-dfe';
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
  /** Resumos que foram atualizados pra NFe completa (upgrade após ciência) */
  nfesUpgradeResumoParaCompleta: number;
  nfesResumoInseridas: number;
  duplicadas: number;
  eventosIgnorados: number;
  eventosCancelamentoAplicados: number;
  eventosSemNota: number;
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

/** Extrai chave + tpEvento de um XML de evento (procEventoNFe OU resEvento). */
function parseEvento(xml: string): {
  chave: string;
  tpEvento: string;
  nProt: string | null;
  dhEvento: string | null;
} | null {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });
  const p = parser.parse(xml) as Record<string, unknown>;

  // resEvento (resumo)
  const resEv = p.resEvento as Record<string, unknown> | undefined;
  if (resEv) {
    const chave = String(resEv.chNFe ?? '').replace(/\D/g, '');
    if (!/^\d{44}$/.test(chave)) return null;
    return {
      chave,
      tpEvento: String(resEv.tpEvento ?? ''),
      nProt: resEv.nProt ? String(resEv.nProt) : null,
      dhEvento: resEv.dhEvento ? String(resEv.dhEvento) : null,
    };
  }

  // procEventoNFe (evento completo)
  const proc = p.procEventoNFe as Record<string, unknown> | undefined;
  if (proc) {
    const evento = proc.evento as Record<string, unknown> | undefined;
    const inf = evento?.infEvento as Record<string, unknown> | undefined;
    const chave = String(inf?.chNFe ?? '').replace(/\D/g, '');
    if (!/^\d{44}$/.test(chave)) return null;
    const ret = proc.retEvento as Record<string, unknown> | undefined;
    const infRet = ret?.infEvento as Record<string, unknown> | undefined;
    return {
      chave,
      tpEvento: String(inf?.tpEvento ?? ''),
      nProt: infRet?.nProt ? String(infRet.nProt) : null,
      dhEvento: inf?.dhEvento ? String(inf.dhEvento) : null,
    };
  }

  return null;
}

/** Aplica um evento relevante (cancelamento) à nota_compra correspondente. */
async function aplicarEvento(
  filialId: string,
  xml: string,
): Promise<'APLICADO' | 'IGNORADO' | 'SEM_NOTA' | 'ERRO'> {
  const ev = parseEvento(xml);
  if (!ev) return 'ERRO';

  // 110111 = cancelamento
  if (ev.tpEvento === '110111') {
    const r = await db
      .update(schema.notaCompra)
      .set({
        situacao: 'CANCELADA',
        protocoloAutorizacao: ev.nProt ?? undefined,
      })
      .where(
        and(eq(schema.notaCompra.filialId, filialId), eq(schema.notaCompra.chave, ev.chave)),
      )
      .returning({ id: schema.notaCompra.id });
    return r.length > 0 ? 'APLICADO' : 'SEM_NOTA';
  }

  // Outros eventos (ciência nossa, CCe, etc) ignoramos por ora
  return 'IGNORADO';
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

/** Dado uma NFe completa (procNFe decomprimido), faz upsert idempotente.
 *  Se já existe como resumo (SEFAZ_DFE_RESUMO ou _CIENTE), atualiza com
 *  dados completos (upgrade) em vez de marcar como duplicada.
 */
async function inserirNfeCompleta(
  filialId: string,
  xml: string,
): Promise<'INSERIDA' | 'ATUALIZADA' | 'DUPLICADA' | 'ERRO'> {
  let nfe;
  try {
    nfe = parseNfeXml(xml);
  } catch {
    return 'ERRO';
  }

  const [existente] = await db
    .select({
      id: schema.notaCompra.id,
      origemImportacao: schema.notaCompra.origemImportacao,
    })
    .from(schema.notaCompra)
    .where(
      and(eq(schema.notaCompra.filialId, filialId), eq(schema.notaCompra.chave, nfe.chave)),
    )
    .limit(1);

  const ehResumo =
    existente?.origemImportacao === 'SEFAZ_DFE_RESUMO' ||
    existente?.origemImportacao === 'SEFAZ_DFE_RESUMO_CIENTE';

  if (existente && !ehResumo) return 'DUPLICADA';

  // Match com fallback cross-filial — replica fornecedor de outra filial
  // da mesma org se nao achar na filial alvo. Ultimo fallback: cria do XML.
  const fornecedorId = await resolverFornecedorParaNota({
    filialId,
    emitCnpj: nfe.emitCnpj,
    emitNome: nfe.emitNome,
    emitFantasia: nfe.emitFantasia,
    emitIe: nfe.emitIe,
    emitUf: nfe.emitUf,
    emitCidade: nfe.emitCidade,
  });

  const xmlHash = createHash('sha256').update(xml).digest('hex');

  const valores = {
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
    origemImportacao: 'SEFAZ_DFE' as const,
  };

  let notaCompraId: string;
  let upgrade = false;

  if (existente && ehResumo) {
    // Upgrade: substitui resumo pela versão completa
    await db
      .update(schema.notaCompra)
      .set({ ...valores, atualizadoEm: new Date() })
      .where(eq(schema.notaCompra.id, existente.id));
    notaCompraId = existente.id;
    upgrade = true;
    // Remove itens antigos (se por acaso existirem — resumo não cria)
    await db
      .delete(schema.notaCompraItem)
      .where(eq(schema.notaCompraItem.notaCompraId, existente.id));
  } else {
    const [nova] = await db
      .insert(schema.notaCompra)
      .values({ filialId, chave: nfe.chave, ...valores })
      .returning({ id: schema.notaCompra.id });
    notaCompraId = nova!.id;
  }

  if (nfe.itens.length > 0) {
    await db.insert(schema.notaCompraItem).values(
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

  // Auto-match com pedido_compra (cotacao -> pedido -> NF -> estoque)
  if (fornecedorId && nfe.dataEmissao) {
    try {
      await tentarMatchPedidoComNota({
        notaCompraId,
        filialId,
        fornecedorId,
        dataEmissao: new Date(nfe.dataEmissao),
      });
    } catch (e) {
      // Falha do match nao deve quebrar a ingestao da NFe
      console.error('match pedido x NF falhou:', (e as Error).message);
    }
  }

  return upgrade ? 'ATUALIZADA' : 'INSERIDA';
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

  const fornecedorId = await resolverFornecedorParaNota({
    filialId,
    emitCnpj: r.emitCnpj,
    emitNome: r.emitNome,
    // resumo (resNFe) so traz CNPJ + nome — nao tem fantasia/IE/UF/cidade
  });

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

  // Busca cert ativo (proprio da filial OU compartilhado de outra filial da mesma org)
  const row = await findActiveCertForFilial(opts.filialId);
  if (!row) throw new Error('filial sem certificado A1 disponivel (nem proprio nem compartilhado)');

  const cnpjConsulta = row.filialCnpj;
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
  let nfesUpgradeResumoParaCompleta = 0;
  let nfesResumoInseridas = 0;
  let duplicadas = 0;
  let eventosIgnorados = 0;
  let eventosCancelamentoAplicados = 0;
  let eventosSemNota = 0;
  const erros: string[] = [];

  for (const d of resp.docs) {
    try {
      if (d.tipo === 'NFE_COMPLETA') {
        const r = await inserirNfeCompleta(opts.filialId, d.xml);
        if (r === 'INSERIDA') nfesCompletasInseridas++;
        else if (r === 'ATUALIZADA') nfesUpgradeResumoParaCompleta++;
        else if (r === 'DUPLICADA') duplicadas++;
        else erros.push(`NSU ${d.nsu}: erro parse procNFe`);
      } else if (d.tipo === 'NFE_RESUMO') {
        const r = await inserirResumo(opts.filialId, d.xml);
        if (r === 'INSERIDA') nfesResumoInseridas++;
        else if (r === 'DUPLICADA') duplicadas++;
        else erros.push(`NSU ${d.nsu}: erro parse resNFe`);
      } else if (d.tipo === 'EVENTO_COMPLETO' || d.tipo === 'EVENTO_RESUMO') {
        const r = await aplicarEvento(opts.filialId, d.xml);
        if (r === 'APLICADO') eventosCancelamentoAplicados++;
        else if (r === 'SEM_NOTA') eventosSemNota++;
        else eventosIgnorados++;
      } else {
        eventosIgnorados++;
      }
    } catch (e) {
      erros.push(`NSU ${d.nsu}: ${(e as Error).message}`);
    }
  }

  // Atualiza checkpoint mesmo quando cStat != 138 — SEFAZ sempre devolve ultNSU válido.
  // (se houver ERRO sem ultNSU, volta o antes)
  const ultNsuDepois = resp.ultNSU && resp.ultNSU !== '000000000000000' ? resp.ultNSU : ultNsuAntes;

  // Atualiza checkpoint NSU pra esse par (cert, filial). Cada filial tem
  // sequencia NSU propria na SEFAZ — nao podemos sobrescrever o NSU global do cert.
  await atualizarNsu({
    certId: row.certId,
    filialId: opts.filialId,
    novoNsu: ultNsuDepois,
  });
  // Tambem atualiza ultima_consulta_sefaz no cert (puramente informativo)
  await db
    .update(schema.certificadoFilial)
    .set({ ultimaConsultaSefaz: new Date() })
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
    nfesUpgradeResumoParaCompleta,
    nfesResumoInseridas,
    duplicadas,
    eventosIgnorados,
    eventosCancelamentoAplicados,
    eventosSemNota,
    erros,
    temMais: resp.maxNSU > ultNsuDepois,
  };
}

export interface ResultadoBuscaXml {
  filialId: string;
  tentadas: number;
  /** Chaves que viraram nota completa (com itens). */
  completas: string[];
  /** Chaves em que a SEFAZ não devolveu o XML (ou deu erro ao gravar). */
  semXml: { chave: string; motivo: string }[];
  /** cStat 656: a SEFAZ bloqueou o CNPJ por 1 h — parou de consultar. */
  bloqueio: string | null;
}

/** Busca o XML completo nota a nota pela chave (consChNFe), sem depender da
 *  fila de NSU. Pra nota que já tem ciência/confirmação e o procNFe não chegou
 *  pela fila (no Bar ~1/3 das cientes ficou presa em "Aguard." entre jun e
 *  out/2026). A SEFAZ só entrega até 90 dias da autorização e limita ~20
 *  consultas por chave por hora por CNPJ (656 = bloqueio de 1 h), então cada
 *  chamada faz no máximo 15 e roda as que foram tentadas há mais tempo
 *  primeiro (marca atualizado_em em cada tentativa). */
export async function buscarXmlPorChave(opts: {
  filialId: string;
  /** Se informado, só essas chaves (resumo ou ciente). Senão, as cientes da filial. */
  chaves?: string[];
  limite?: number;
  uf?: string;
  tpAmb?: 1 | 2;
}): Promise<ResultadoBuscaXml> {
  const limite = Math.min(opts.limite ?? 10, 15);
  const res: ResultadoBuscaXml = {
    filialId: opts.filialId,
    tentadas: 0,
    completas: [],
    semXml: [],
    bloqueio: null,
  };
  const individual = !!(opts.chaves && opts.chaves.length);

  const alvos = await db
    .select({ id: schema.notaCompra.id, chave: schema.notaCompra.chave })
    .from(schema.notaCompra)
    .where(
      and(
        eq(schema.notaCompra.filialId, opts.filialId),
        individual
          ? and(
              inArray(schema.notaCompra.chave, opts.chaves!),
              inArray(schema.notaCompra.origemImportacao, [
                'SEFAZ_DFE_RESUMO',
                'SEFAZ_DFE_RESUMO_CIENTE',
              ]),
            )
          : eq(schema.notaCompra.origemImportacao, 'SEFAZ_DFE_RESUMO_CIENTE'),
        sql`coalesce(${schema.notaCompra.situacao}, '') <> 'CANCELADA'`,
        sql`coalesce(${schema.notaCompra.dataAutorizacao}, ${schema.notaCompra.dataEmissao}) >= now() - interval '90 days'`,
      ),
    )
    .orderBy(asc(schema.notaCompra.atualizadoEm), desc(schema.notaCompra.dataEmissao))
    .limit(limite);
  if (alvos.length === 0) return res;

  const uf = (opts.uf ?? 'SE').toUpperCase();
  const cUF = UF_CODIGO[uf];
  if (!cUF) throw new Error(`UF invalida: ${uf}`);
  const row = await findActiveCertForFilial(opts.filialId);
  if (!row) throw new Error('filial sem certificado A1 disponivel (nem proprio nem compartilhado)');
  const pfxBytes = await baixarPfx(row.pfxStoragePath);
  const senhaPfx = decifrarSenha(row.senhaCifrada);

  for (const a of alvos) {
    res.tentadas++;
    let motivo: string | null = null;
    try {
      const r = await consultarPorChave({
        pfxBytes,
        senhaPfx,
        cnpj: row.filialCnpj,
        cUF,
        chave: a.chave,
        tpAmb: opts.tpAmb ?? 1,
      });
      if (r.cStat === '656') {
        res.bloqueio = `${r.cStat} ${r.xMotivo}`;
        res.tentadas--;
        break;
      }
      // Cancelamento que vier junto já marca a nota
      for (const d of r.docs) {
        if (d.tipo === 'EVENTO_COMPLETO' || d.tipo === 'EVENTO_RESUMO') {
          await aplicarEvento(opts.filialId, d.xml);
        }
      }
      const completa = r.docs.find((d) => d.tipo === 'NFE_COMPLETA' && d.chave === a.chave);
      if (completa) {
        const g = await inserirNfeCompleta(opts.filialId, completa.xml);
        if (g === 'ATUALIZADA' || g === 'INSERIDA') res.completas.push(a.chave);
        else motivo = g === 'ERRO' ? 'XML veio mas não deu pra ler' : 'já estava completa';
      } else if (r.docs.some((d) => d.tipo === 'NFE_RESUMO')) {
        motivo = 'SEFAZ ainda só entrega o resumo (falta ciência/confirmação registrada)';
      } else {
        motivo = `${r.cStat} ${r.xMotivo}`.trim() || 'sem resposta da SEFAZ';
      }
    } catch (e) {
      motivo = (e as Error).message.slice(0, 200);
    }
    if (motivo) {
      res.semXml.push({ chave: a.chave, motivo });
      // Gira a fila: a próxima rodada começa pelas que não foram tentadas
      await db
        .update(schema.notaCompra)
        .set({ atualizadoEm: new Date() })
        .where(eq(schema.notaCompra.id, a.id));
    }
  }
  return res;
}
