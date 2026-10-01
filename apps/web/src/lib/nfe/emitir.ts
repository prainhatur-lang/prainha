// Emissão da NF-e (modelo 55) de TRANSFERÊNCIA entre casas.
//
// É opcional: a transferência vale sozinha (só financeiro). Quem enviou pode
// pedir a nota depois — a tela pergunta logo após registrar e o botão fica na
// lista. Mesmo transporte da NFC-e (cert A1 da filial → SVRS, síncrono).
//
// Idempotente por (transferência, ambiente): AUTORIZADA devolve a mesma nota;
// PENDENTE consulta a chave na SEFAZ antes de reenviar (timeout não pode virar
// nota duplicada); REJEITADA/ERRO reusa o número alocado.

import { db, schema } from '@concilia/db';
import type { FiscalConfig } from '@concilia/db/schema';
import { and, desc, eq, inArray, sql as dsql } from 'drizzle-orm';
import { contextoFiscal } from '@/lib/nfce/emitir';
import { assinarNfe } from '@/lib/nfce/assinar';
import { enviarNfce, consultarChave, cancelarNfce, statusServico, type ProtocoloNfce } from '@/lib/nfce/sefaz';
import { montarXmlNfeTransferencia, pendenciasNfe, type NfeTransfItem } from './xml';

type NfeRow = typeof schema.nfeEmitida.$inferSelect;

export interface NfeResumo {
  id: string;
  chave: string;
  numero: number;
  serie: number;
  ambiente: number;
  protocolo: string | null;
  valorTotal: number;
  status: string;
}

export type EmitirNfeResultado =
  | { ok: true; jaExistia: boolean; nota: NfeResumo }
  | {
      ok: false;
      erro: string;
      cstat?: string;
      /** Falha de transporte (SEFAZ/rede) — pode tentar de novo sem medo de duplicar. */
      transitorio?: boolean;
    };

const resumo = (r: NfeRow): NfeResumo => ({
  id: r.id,
  chave: r.chave,
  numero: r.numero,
  serie: r.serie,
  ambiente: r.ambiente,
  protocolo: r.protocolo,
  valorTotal: Number(r.valorTotal),
  status: r.status,
});

/** Série e ambiente da NF-e da casa (padrão: série 1, mesmo ambiente da NFC-e). */
export function parametrosNfe(cfg: FiscalConfig | null | undefined, forcarHomologacao = false) {
  const serie = cfg?.nfe?.serie && cfg.nfe.serie > 0 ? cfg.nfe.serie : 1;
  const amb = cfg?.nfe?.ambiente ?? (cfg?.ambiente === 1 ? 1 : 2);
  const tpAmb: 1 | 2 = forcarHomologacao ? 2 : amb === 1 ? 1 : 2;
  return { serie, tpAmb };
}

async function temAcesso(userId: string, filialId: string): Promise<boolean> {
  const [a] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, userId), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  return !!a;
}

function montarNfeProc(nfeAssinada: string, protXml: string | null): string | null {
  if (!protXml) return null;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    nfeAssinada.replace(/^<\?xml[^>]*\?>/, '') +
    protXml +
    `</nfeProc>`
  );
}

async function marcarAutorizada(rowId: string, prot: ProtocoloNfce, nfeAssinada: string | null): Promise<NfeRow> {
  const [r] = await db
    .update(schema.nfeEmitida)
    .set({
      status: 'AUTORIZADA',
      cstat: prot.cStat,
      xmotivo: prot.xMotivo,
      protocolo: prot.nProt,
      autorizadaEm: prot.dhRecbto ? new Date(prot.dhRecbto) : new Date(),
      xml: nfeAssinada ? (montarNfeProc(nfeAssinada, prot.protXml) ?? nfeAssinada) : undefined,
      erro: null,
      atualizadoEm: new Date(),
    })
    .where(eq(schema.nfeEmitida.id, rowId))
    .returning();
  return r!;
}

/** Próximo número da série (atômico — upsert com incremento). */
async function alocarNumero(filialId: string, serie: number, ambiente: number): Promise<number> {
  const [r] = await db
    .insert(schema.nfeNumeracao)
    .values({ filialId, serie, ambiente, ultimoNumero: 1 })
    .onConflictDoUpdate({
      target: [schema.nfeNumeracao.filialId, schema.nfeNumeracao.serie, schema.nfeNumeracao.ambiente],
      set: { ultimoNumero: dsql`${schema.nfeNumeracao.ultimoNumero} + 1` },
    })
    .returning({ numero: schema.nfeNumeracao.ultimoNumero });
  if (!r) throw new Error('falha alocando número da NF-e');
  return r.numero;
}

/** Itens da transferência no formato da nota: código, unidade e NCM do
 *  produto da casa que envia. NCM: cadastro → última nota de compra desse
 *  produto → padrão da config (o builder aplica). */
async function itensDaTransferencia(transferenciaId: string, recebida: boolean): Promise<NfeTransfItem[]> {
  const rows = await db
    .select({
      produtoId: schema.transferenciaFilialItem.produtoOrigemId,
      descricao: schema.transferenciaFilialItem.descricao,
      quantidade: schema.transferenciaFilialItem.quantidade,
      quantidadeRecebida: schema.transferenciaFilialItem.quantidadeRecebida,
      custoUnitario: schema.transferenciaFilialItem.custoUnitario,
      nome: schema.produto.nome,
      codigoExterno: schema.produto.codigoExterno,
      unidade: schema.produto.unidadeEstoque,
      ncm: schema.produto.ncm,
    })
    .from(schema.transferenciaFilialItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.transferenciaFilialItem.produtoOrigemId))
    .where(eq(schema.transferenciaFilialItem.transferenciaId, transferenciaId))
    .orderBy(schema.transferenciaFilialItem.descricao);

  const semNcm = rows.filter((r) => !/^\d{8}$/.test(String(r.ncm ?? '').replace(/\D/g, ''))).map((r) => r.produtoId);
  const ncmDaCompra = new Map<string, string>();
  if (semNcm.length) {
    const compras = await db
      .select({
        produtoId: schema.notaCompraItem.produtoId,
        ncm: schema.notaCompraItem.ncm,
        emissao: schema.notaCompra.dataEmissao,
      })
      .from(schema.notaCompraItem)
      .innerJoin(schema.notaCompra, eq(schema.notaCompra.id, schema.notaCompraItem.notaCompraId))
      .where(inArray(schema.notaCompraItem.produtoId, [...new Set(semNcm)]))
      .orderBy(desc(schema.notaCompra.dataEmissao));
    for (const c of compras) {
      const d = String(c.ncm ?? '').replace(/\D/g, '');
      if (c.produtoId && /^\d{8}$/.test(d) && d !== '00000000' && !ncmDaCompra.has(c.produtoId)) {
        ncmDaCompra.set(c.produtoId, d);
      }
    }
  }

  return rows
    .map((r) => {
      // Já conferida: vale o que a casa recebeu (a diferença voltou pra origem)
      const q = recebida ? Number(r.quantidadeRecebida ?? r.quantidade) : Number(r.quantidade);
      return {
        codigo: r.codigoExterno != null ? String(r.codigoExterno) : r.produtoId.slice(0, 8),
        descricao: r.descricao ?? r.nome ?? 'ITEM',
        quantidade: q,
        valorTotal: Math.round(q * Number(r.custoUnitario) * 100) / 100,
        unidade: r.unidade ?? 'UN',
        ncm: /^\d{8}$/.test(String(r.ncm ?? '').replace(/\D/g, '')) ? r.ncm : (ncmDaCompra.get(r.produtoId) ?? null),
      };
    })
    .filter((i) => i.quantidade > 0);
}

export async function emitirNfeTransferencia(
  opts: { transferenciaId: string; userId: string; homologacao?: boolean },
  tentativa = 0,
): Promise<EmitirNfeResultado> {
  const [t] = await db
    .select()
    .from(schema.transferenciaFilial)
    .where(eq(schema.transferenciaFilial.id, opts.transferenciaId))
    .limit(1);
  if (!t) return { ok: false, erro: 'transferência não encontrada' };
  if (!(await temAcesso(opts.userId, t.filialOrigemId))) {
    return { ok: false, erro: 'só a casa que enviou emite a nota fiscal da transferência' };
  }
  if (t.status === 'CANCELADA') return { ok: false, erro: 'transferência cancelada — não cabe nota fiscal' };

  const ctxR = await contextoFiscal(t.filialOrigemId, { paraEmitir: false });
  if (!ctxR.ok) return { ok: false, erro: ctxR.erro };
  const ctx = ctxR.ctx;
  const [dest] = await db
    .select({ cnpj: schema.filial.cnpj, nome: schema.filial.nome, cfg: schema.filial.fiscalConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, t.filialDestinoId))
    .limit(1);
  if (!dest) return { ok: false, erro: 'casa que recebe não encontrada' };
  const pe = pendenciasNfe(ctx.cfg);
  if (pe.length) return { ok: false, erro: `config fiscal da casa que envia incompleta: ${pe.join('; ')}` };
  const pd = pendenciasNfe(dest.cfg);
  if (pd.length) return { ok: false, erro: `config fiscal de ${dest.nome} incompleta: ${pd.join('; ')}` };

  const { serie, tpAmb } = parametrosNfe(ctx.cfg, opts.homologacao === true);
  const modelo = 55 as const;

  // nota "viva" dessa transferência nesse ambiente?
  const [viva] = await db
    .select()
    .from(schema.nfeEmitida)
    .where(
      and(
        eq(schema.nfeEmitida.transferenciaId, t.id),
        eq(schema.nfeEmitida.ambiente, tpAmb),
        inArray(schema.nfeEmitida.status, ['PENDENTE', 'AUTORIZADA']),
      ),
    )
    .orderBy(desc(schema.nfeEmitida.criadoEm))
    .limit(1);
  if (viva?.status === 'AUTORIZADA') return { ok: true, jaExistia: true, nota: resumo(viva) };

  if (viva?.status === 'PENDENTE') {
    // tentativa anterior morreu no meio — confere na SEFAZ antes de reenviar
    try {
      const cons = await consultarChave({ chave: viva.chave, tpAmb, pem: ctx.pem, modelo });
      if (cons.cStat === '100' && cons.prot) {
        return { ok: true, jaExistia: true, nota: resumo(await marcarAutorizada(viva.id, cons.prot, viva.xml)) };
      }
    } catch {
      return { ok: false, transitorio: true, erro: 'SEFAZ instável agora — tente de novo em instantes' };
    }
  }

  let reuso: NfeRow | null = viva ?? null;
  if (!reuso) {
    const [antiga] = await db
      .select()
      .from(schema.nfeEmitida)
      .where(
        and(
          eq(schema.nfeEmitida.transferenciaId, t.id),
          eq(schema.nfeEmitida.ambiente, tpAmb),
          inArray(schema.nfeEmitida.status, ['REJEITADA', 'ERRO']),
        ),
      )
      .orderBy(desc(schema.nfeEmitida.criadoEm))
      .limit(1);
    if (antiga && antiga.serie === serie) reuso = antiga;
  }
  const numero =
    reuso && reuso.serie === serie && reuso.ambiente === tpAmb
      ? reuso.numero
      : await alocarNumero(t.filialOrigemId, serie, tpAmb);

  const itens = await itensDaTransferencia(t.id, t.status !== 'ENVIADA');
  const infoExtra =
    `Transferencia ${t.numero} entre estabelecimentos do mesmo titular, sem cobranca. ` +
    `Documento emitido por ME ou EPP optante pelo Simples Nacional. ` +
    `Nao gera direito a credito fiscal de IPI.`;

  let montado;
  try {
    montado = montarXmlNfeTransferencia({
      emitente: ctx.cfg,
      cnpjEmitente: ctx.cnpj,
      destinatario: dest.cfg as FiscalConfig,
      cnpjDestinatario: dest.cnpj,
      tpAmb,
      serie,
      numero,
      itens,
      infoExtra,
    });
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }

  let nfeAssinada: string;
  try {
    nfeAssinada = assinarNfe(montado.nfe, ctx.pem);
  } catch (e) {
    return { ok: false, erro: `falha assinando XML: ${(e as Error).message}` };
  }

  const valores = {
    ambiente: tpAmb,
    serie,
    numero,
    chave: montado.chave,
    cnf: montado.cnf,
    status: 'PENDENTE',
    cstat: null as string | null,
    xmotivo: null as string | null,
    filialDestinoId: t.filialDestinoId,
    destCnpj: dest.cnpj.replace(/\D/g, ''),
    naturezaOperacao: montado.naturezaOperacao,
    valorTotal: String(montado.vNF),
    itens: montado.itens,
    infoExtra,
    xml: nfeAssinada,
    erro: null as string | null,
    solicitadoPor: opts.userId,
    atualizadoEm: new Date(),
  };

  let rowId: string;
  if (reuso) {
    await db.update(schema.nfeEmitida).set(valores).where(eq(schema.nfeEmitida.id, reuso.id));
    rowId = reuso.id;
  } else {
    const inseridos = await db
      .insert(schema.nfeEmitida)
      .values({ filialId: t.filialOrigemId, transferenciaId: t.id, ...valores })
      .onConflictDoNothing()
      .returning({ id: schema.nfeEmitida.id });
    if (!inseridos[0]) {
      // corrida: outro clique entrou primeiro — reprocessa uma vez
      if (tentativa >= 1) return { ok: false, erro: 'emissão simultânea da mesma nota — tente de novo' };
      return emitirNfeTransferencia(opts, tentativa + 1);
    }
    rowId = inseridos[0].id;
  }

  let retorno;
  try {
    retorno = await enviarNfce({ nfeAssinada, tpAmb, pem: ctx.pem, modelo });
  } catch (e) {
    await db
      .update(schema.nfeEmitida)
      .set({ erro: (e as Error).message.slice(0, 500), atualizadoEm: new Date() })
      .where(eq(schema.nfeEmitida.id, rowId));
    return {
      ok: false,
      transitorio: true,
      erro: 'SEFAZ não respondeu — a nota NÃO foi perdida; clique em emitir de novo que o sistema confere antes de reenviar',
    };
  }

  const prot = retorno.prot;
  if (prot?.cStat === '100') {
    return { ok: true, jaExistia: false, nota: resumo(await marcarAutorizada(rowId, prot, nfeAssinada)) };
  }

  // 204 = duplicidade (a chave JÁ está lá — o envio anterior chegou): adota
  const cstatRej = prot?.cStat ?? retorno.cStatLote;
  const xmotivoRej = prot?.xMotivo ?? retorno.xMotivoLote;
  if (cstatRej === '204') {
    try {
      const cons = await consultarChave({ chave: montado.chave, tpAmb, pem: ctx.pem, modelo });
      if (cons.cStat === '100' && cons.prot) {
        return { ok: true, jaExistia: true, nota: resumo(await marcarAutorizada(rowId, cons.prot, nfeAssinada)) };
      }
    } catch {
      /* cai na rejeição normal */
    }
  }

  await db
    .update(schema.nfeEmitida)
    .set({ status: 'REJEITADA', cstat: cstatRej || null, xmotivo: xmotivoRej || null, atualizadoEm: new Date() })
    .where(eq(schema.nfeEmitida.id, rowId));
  return { ok: false, cstat: cstatRej, erro: `SEFAZ rejeitou (${cstatRej}): ${xmotivoRej}` };
}

const CSTAT_CANCEL_OK = new Set(['135', '136', '155', '573']);

/** Cancela a NF-e autorizada (evento 110111). O prazo é da SEFAZ (24h na
 *  NF-e) — fora dele o motivo dela volta pro usuário. */
export async function cancelarNfeEmitida(opts: {
  nfeId: string;
  userId: string;
  justificativa: string;
}): Promise<{ ok: true; protocolo: string | null } | { ok: false; erro: string; transitorio?: boolean }> {
  const [nota] = await db.select().from(schema.nfeEmitida).where(eq(schema.nfeEmitida.id, opts.nfeId)).limit(1);
  if (!nota) return { ok: false, erro: 'nota não encontrada' };
  if (!(await temAcesso(opts.userId, nota.filialId))) return { ok: false, erro: 'sem acesso à casa que emitiu' };
  if (nota.status !== 'AUTORIZADA' || !nota.protocolo) {
    return { ok: false, erro: `só nota AUTORIZADA pode ser cancelada (esta está ${nota.status})` };
  }
  const ctxR = await contextoFiscal(nota.filialId, { paraEmitir: false });
  if (!ctxR.ok) return { ok: false, erro: ctxR.erro };
  try {
    const r = await cancelarNfce({
      chave: nota.chave,
      protocolo: nota.protocolo,
      justificativa: opts.justificativa,
      cnpj: ctxR.ctx.cnpj,
      cOrgao: ctxR.ctx.cUF,
      tpAmb: nota.ambiente === 1 ? 1 : 2,
      pem: ctxR.ctx.pem,
      modelo: 55,
    });
    if (!CSTAT_CANCEL_OK.has(r.cStat)) {
      return { ok: false, erro: `SEFAZ recusou o cancelamento (${r.cStat}): ${r.xMotivo}` };
    }
    await db
      .update(schema.nfeEmitida)
      .set({
        status: 'CANCELADA',
        canceladaEm: new Date(),
        protocoloCancelamento: r.nProt,
        justificativaCancelamento: opts.justificativa,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.nfeEmitida.id, nota.id));
    return { ok: true, protocolo: r.nProt };
  } catch (e) {
    return { ok: false, transitorio: true, erro: `falha falando com a SEFAZ: ${(e as Error).message}` };
  }
}

/** Ping do serviço de NF-e (modelo 55) da SVRS com o certificado da casa. */
export async function testarNfe(filialId: string) {
  const ctxR = await contextoFiscal(filialId, { paraEmitir: false });
  if (!ctxR.ok) return { ok: false as const, erro: ctxR.erro };
  const { serie, tpAmb } = parametrosNfe(ctxR.ctx.cfg);
  const pendencias = pendenciasNfe(ctxR.ctx.cfg);
  try {
    const st = await statusServico({ cUF: ctxR.ctx.cUF, tpAmb, pem: ctxR.ctx.pem, modelo: 55 });
    return {
      ok: st.cStat === '107',
      cStat: st.cStat,
      xMotivo: st.xMotivo,
      ambiente: tpAmb === 1 ? 'produção' : 'homologação',
      serie,
      pendencias,
    };
  } catch (e) {
    return { ok: false as const, erro: `SEFAZ não respondeu: ${(e as Error).message}`, pendencias };
  }
}

/** Nota que vale pra tela, por transferência: a de produção autorizada;
 *  senão a mais recente (pra mostrar rejeição/pendência/homologação). */
export async function nfesDasTransferencias(ids: string[]): Promise<Map<string, NfeRow>> {
  const out = new Map<string, NfeRow>();
  if (!ids.length) return out;
  const rows = await db
    .select()
    .from(schema.nfeEmitida)
    .where(inArray(schema.nfeEmitida.transferenciaId, ids))
    .orderBy(desc(schema.nfeEmitida.criadoEm));
  const peso = (r: NfeRow) =>
    (r.status === 'AUTORIZADA' ? 4 : r.status === 'PENDENTE' ? 3 : r.status === 'CANCELADA' ? 2 : 1) * 10 +
    (r.ambiente === 1 ? 1 : 0);
  for (const r of rows) {
    if (!r.transferenciaId) continue;
    const atual = out.get(r.transferenciaId);
    if (!atual || peso(r) > peso(atual)) out.set(r.transferenciaId, r);
  }
  return out;
}
