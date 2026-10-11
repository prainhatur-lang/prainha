// NF-e (modelo 55) AVULSA de venda de bem do ativo imobilizado — a casa vendeu
// um bem dela (o carro, um freezer) e dá nota pro comprador. Não nasce de
// cupom nem de transferência (ver xml-avulsa.ts). Mesmo transporte e mesmas
// travas das outras NF-e (emitir.ts / emitir-cupom.ts).
//
// Idempotente pelo id que a TELA gera pra cada nota: o mesmo clique repetido
// (ou a mesma tela reenviada depois de um timeout) cai na mesma linha —
// AUTORIZADA devolve a mesma nota; PENDENTE consulta a chave na SEFAZ antes de
// reenviar; REJEITADA/ERRO reusa o número. Nota avulsa no banco = linha de
// nfe_emitida sem transferência e sem cupom de origem.

import { db, schema } from '@concilia/db';
import type { NfeDestinatarioSnapshot } from '@concilia/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { contextoFiscal } from '@/lib/nfce/emitir';
import { assinarNfe } from '@/lib/nfce/assinar';
import { enviarNfce, consultarChave } from '@/lib/nfce/sefaz';
import { validarDocumento } from '@/lib/nfce/documento';
import { pendenciasNfe } from './xml';
import {
  alocarNumero,
  marcarAutorizada,
  parametrosNfe,
  resumo,
  serieEmUso,
  temAcesso,
  MAX_TROCAS_SERIE,
  type EmitirNfeResultado,
} from './emitir';
import { normalizarDestinatario, salvarDestinatario } from './emitir-cupom';
import { pendenciasDestinatario } from './xml-cupom';
import { montarXmlNfeAvulsa, type NfeAvulsaFiscal, type NfeAvulsaItem } from './xml-avulsa';

type NfeRow = typeof schema.nfeEmitida.$inferSelect;

const limpo = (s: string | null | undefined, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function emitirNfeAvulsa(
  opts: {
    /** Gerado pela tela (um por nota e ambiente) — é a chave da idempotência. */
    id: string;
    filialId: string;
    userId: string;
    destinatario: Partial<NfeDestinatarioSnapshot>;
    itens: NfeAvulsaItem[];
    formaPagamento: string;
    revenda?: boolean;
    fiscal?: NfeAvulsaFiscal;
    infoExtra?: string;
    homologacao?: boolean;
  },
  tentativa = 0,
  trocasSerie = 0,
): Promise<EmitirNfeResultado> {
  if (!(await temAcesso(opts.userId, opts.filialId))) return { ok: false, erro: 'sem acesso a esta casa' };

  const ctxR = await contextoFiscal(opts.filialId, { paraEmitir: false });
  if (!ctxR.ok) return { ok: false, erro: ctxR.erro };
  const ctx = ctxR.ctx;
  const pe = pendenciasNfe(ctx.cfg);
  if (pe.length) return { ok: false, erro: `config fiscal da casa incompleta: ${pe.join('; ')}` };

  const { tpAmb } = parametrosNfe(ctx.cfg, opts.homologacao === true);

  const dest = normalizarDestinatario(opts.destinatario);
  const docOk = validarDocumento(dest.documento);
  if (!docOk) return { ok: false, erro: 'CPF/CNPJ do comprador inválido' };
  dest.documento = docOk.doc;
  const pd = pendenciasDestinatario(dest);
  if (pd.length) return { ok: false, erro: `falta no cadastro do comprador: ${pd.join('; ')}` };
  if (dest.documento === ctx.cnpj.replace(/\D/g, '')) {
    return { ok: false, erro: 'o comprador tem o mesmo CNPJ da casa — não cabe nota fiscal pra ela mesma' };
  }

  // cadastro conferido fica guardado (teste ou nota de verdade)
  if (tentativa === 0 && trocasSerie === 0) await salvarDestinatario(opts.filialId, dest, opts.userId);

  const serie = await serieEmUso(opts.filialId, ctx.cfg, tpAmb);
  const modelo = 55 as const;

  // essa nota (mesmo id da tela) já foi pedida antes?
  const [linha] = await db.select().from(schema.nfeEmitida).where(eq(schema.nfeEmitida.id, opts.id)).limit(1);
  if (linha) {
    if (linha.filialId !== opts.filialId || linha.transferenciaId || linha.nfceOrigemId || linha.ambiente !== tpAmb) {
      return { ok: false, erro: 'esta tela está desatualizada — recarregue a página e tente de novo' };
    }
    if (linha.status === 'AUTORIZADA') return { ok: true, jaExistia: true, nota: resumo(linha) };
    if (linha.status === 'CANCELADA') {
      return { ok: false, erro: 'esta nota foi cancelada — recarregue a página pra emitir outra' };
    }
    if (linha.status === 'PENDENTE') {
      // tentativa anterior morreu no meio — confere na SEFAZ antes de reenviar
      try {
        const cons = await consultarChave({ chave: linha.chave, tpAmb, pem: ctx.pem, modelo });
        if (cons.cStat === '100' && cons.prot) {
          return { ok: true, jaExistia: true, nota: resumo(await marcarAutorizada(linha.id, cons.prot, linha.xml)) };
        }
      } catch {
        return { ok: false, transitorio: true, erro: 'SEFAZ instável agora — tente de novo em instantes' };
      }
    }
  }
  const reuso: NfeRow | null = linha ?? null;
  const numero =
    reuso && reuso.serie === serie && reuso.ambiente === tpAmb
      ? reuso.numero
      : await alocarNumero(opts.filialId, serie, tpAmb);

  const infoExtra = limpo(opts.infoExtra, 2000);

  let montado;
  try {
    montado = montarXmlNfeAvulsa({
      emitente: ctx.cfg,
      cnpjEmitente: ctx.cnpj,
      destinatario: dest,
      tpAmb,
      serie,
      numero,
      itens: opts.itens,
      formaPagamento: opts.formaPagamento,
      revenda: opts.revenda === true,
      fiscal: opts.fiscal,
      infoExtra: infoExtra || undefined,
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
    destCnpj: dest.documento.length === 14 ? dest.documento : null,
    dest,
    naturezaOperacao: montado.naturezaOperacao,
    valorTotal: String(montado.vNF),
    itens: montado.itens,
    infoExtra: infoExtra || null,
    xml: nfeAssinada,
    erro: null as string | null,
    solicitadoPor: opts.userId,
    atualizadoEm: new Date(),
  };

  const rowId = opts.id;
  if (reuso) {
    await db.update(schema.nfeEmitida).set(valores).where(eq(schema.nfeEmitida.id, reuso.id));
  } else {
    const inseridos = await db
      .insert(schema.nfeEmitida)
      .values({ id: opts.id, filialId: opts.filialId, ...valores })
      .onConflictDoNothing()
      .returning({ id: schema.nfeEmitida.id });
    if (!inseridos[0]) {
      // corrida: outro clique entrou primeiro — reprocessa uma vez
      if (tentativa >= 1) return { ok: false, erro: 'emissão simultânea da mesma nota — tente de novo' };
      return emitirNfeAvulsa(opts, tentativa + 1, trocasSerie);
    }
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

  // 539 = esse número da série já existe na SEFAZ com OUTRA chave (numeração de
  // outro sistema): abre a série seguinte e emite nela. Série fixada na config
  // não troca sozinha.
  if (cstatRej === '539' && !(ctx.cfg?.nfe?.serie && ctx.cfg.nfe.serie > 0)) {
    const chaveDeFora = /chNFe:\s*(\d{44})/.exec(xmotivoRej ?? '')?.[1];
    const [nossa] = chaveDeFora
      ? await db
          .select({ id: schema.nfeEmitida.id })
          .from(schema.nfeEmitida)
          .where(eq(schema.nfeEmitida.chave, chaveDeFora))
          .limit(1)
      : [];
    if (chaveDeFora && !nossa && trocasSerie < MAX_TROCAS_SERIE && serie < 889) {
      await db
        .insert(schema.nfeNumeracao)
        .values({ filialId: opts.filialId, serie: serie + 1, ambiente: tpAmb, ultimoNumero: 0 })
        .onConflictDoNothing();
      return emitirNfeAvulsa(opts, 0, trocasSerie + 1);
    }
    return {
      ok: false,
      cstat: cstatRej,
      erro: `SEFAZ rejeitou (539): a série ${serie} da NF-e desta casa já tem o número ${numero} emitido por outro sistema. ${xmotivoRej}`,
    };
  }
  return { ok: false, cstat: cstatRej, erro: `SEFAZ rejeitou (${cstatRej}): ${xmotivoRej}` };
}

const soAvulsa = and(isNull(schema.nfeEmitida.transferenciaId), isNull(schema.nfeEmitida.nfceOrigemId));

/** Notas avulsas da casa (mais nova primeiro). */
export async function nfesAvulsas(filialId: string): Promise<NfeRow[]> {
  return db
    .select()
    .from(schema.nfeEmitida)
    .where(and(eq(schema.nfeEmitida.filialId, filialId), soAvulsa))
    .orderBy(desc(schema.nfeEmitida.criadoEm))
    .limit(50);
}

/** Uma nota avulsa pelo id (null se o id for de nota de cupom/transferência). */
export async function nfeAvulsaPorId(id: string): Promise<NfeRow | null> {
  const [r] = await db
    .select()
    .from(schema.nfeEmitida)
    .where(and(eq(schema.nfeEmitida.id, id), soAvulsa))
    .limit(1);
  return r ?? null;
}
