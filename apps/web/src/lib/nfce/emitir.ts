// Orquestra a emissão de uma NFC-e pra um pedido do vendas-local.
//
// Fluxo: valida config fiscal → resolve cert A1 (o mesmo da distribuição
// DF-e) → aloca número (contador atômico) → monta XML + QR → assina →
// transmite pra SVRS (síncrono) → persiste XML autorizado → devolve blocos
// do DANFE pra imprimir (LIO 32 col / térmica 48 col).
//
// Idempotente por pedido_chave: AUTORIZADA devolve a mesma nota (reimpressão);
// PENDENTE consulta a chave na SEFAZ antes de reenviar (timeout não pode
// virar nota duplicada); REJEITADA/ERRO reusa o número alocado.

import { db, schema } from '@concilia/db';
import type { FiscalConfig, NfceItemSnapshot, NfcePagamentoSnapshot } from '@concilia/db/schema';
import { and, desc, eq, inArray, sql as dsql } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { decifrarSenha } from '@/lib/certificado';
import { findActiveCertForFilial } from '@/lib/certificado-resolver';
import { extrairPem, type PemCert } from '@/lib/sefaz-evento';
import { UF_CODIGO } from '@/lib/sefaz-dfe';
import { montarXmlNfce, inserirSupl } from './xml';
import { montarQrCode } from './qrcode';
import { assinarNfe } from './assinar';
import { enviarNfce, consultarChave, type ProtocoloNfce } from './sefaz';
import { montarDanfeBlocos, type DanfeBloco } from './danfe';
import { validarDocumento, formatarDocumento } from './documento';

export interface EmitirInput {
  /** Idempotência: "<loja>:<PEDIDOS.CODIGO do Firebird>". */
  pedidoChave: string;
  /** Rótulo pra exibição: "MESA 12" / "COMANDA 301". */
  mesa?: string | null;
  /** CPF/CNPJ do consumidor (opcional). */
  documento?: string | null;
  itens: NfceItemSnapshot[];
  pagamentos: NfcePagamentoSnapshot[];
  valorTroco?: number;
  infoExtra?: string | null;
  solicitadoPor?: string | null;
}

export interface NotaEmitida {
  id: string;
  chave: string;
  numero: number;
  serie: number;
  ambiente: number;
  protocolo: string | null;
  valorTotal: number;
  destDocumento: string | null;
  status: string;
}

export type EmitirResultado =
  | {
      ok: true;
      jaExistia: boolean;
      nota: NotaEmitida;
      danfe32: DanfeBloco[];
      danfe48: DanfeBloco[];
    }
  | { ok: false; erro: string; cstat?: string; pendencias?: string[] };

type NfceRow = typeof schema.nfceEmitida.$inferSelect;

/** O que falta pra config fiscal poder emitir. Vazio = pronta. */
export function pendenciasConfig(cfg: FiscalConfig | null | undefined): string[] {
  const p: string[] = [];
  if (!cfg?.ativo) p.push('emissão de NFC-e desligada (ative na config fiscal)');
  if (!cfg?.razaoSocial) p.push('razão social');
  if (!cfg?.ie) p.push('inscrição estadual');
  const e = cfg?.endereco;
  if (!e?.logradouro || !e?.bairro || !e?.codigoMunicipio || !e?.municipio || !e?.uf || !e?.cep)
    p.push('endereço fiscal completo');
  const amb = cfg?.ambiente === 1 ? 1 : 2;
  if (amb === 1 && (!cfg?.cscId || !cfg?.cscToken)) p.push('CSC de produção (id + token)');
  if (amb === 2 && (!cfg?.cscIdHom || !cfg?.cscTokenHom)) p.push('CSC de homologação (id + token)');
  if ((cfg?.crt ?? 1) !== 1) p.push('CRT diferente de Simples Nacional não suportado');
  return p;
}

interface ContextoFiscal {
  filialId: string;
  cnpj: string;
  cfg: FiscalConfig;
  tpAmb: 1 | 2;
  serie: number;
  cUF: number;
  csc: { id: string; token: string };
  pem: PemCert;
}

async function baixarPfx(path: string): Promise<Buffer> {
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from('certificados').download(path);
  if (error) throw new Error(`erro baixando pfx: ${error.message}`);
  if (!data) throw new Error('pfx nao encontrado no storage');
  return Buffer.from(await data.arrayBuffer());
}

/** Carrega filial + config + certificado prontos pra falar com a SEFAZ. */
export async function contextoFiscal(
  filialId: string,
): Promise<{ ok: true; ctx: ContextoFiscal } | { ok: false; erro: string; pendencias?: string[] }> {
  const [fil] = await db
    .select({ id: schema.filial.id, cnpj: schema.filial.cnpj, cfg: schema.filial.fiscalConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  if (!fil) return { ok: false, erro: 'filial não encontrada' };

  const cfg = fil.cfg ?? null;
  const pend = pendenciasConfig(cfg);
  if (pend.length > 0) {
    return { ok: false, erro: `config fiscal incompleta: ${pend.join('; ')}`, pendencias: pend };
  }
  const c = cfg as FiscalConfig;

  const cUF = UF_CODIGO[(c.endereco?.uf ?? 'SE').toUpperCase()];
  if (!cUF) return { ok: false, erro: `UF inválida na config fiscal: ${c.endereco?.uf}` };

  const cert = await findActiveCertForFilial(filialId);
  if (!cert) return { ok: false, erro: 'filial sem certificado A1 (suba em Configurações → Certificados)' };

  let pem: PemCert;
  try {
    const pfx = await baixarPfx(cert.pfxStoragePath);
    pem = extrairPem(pfx, decifrarSenha(cert.senhaCifrada));
  } catch (e) {
    return { ok: false, erro: `certificado A1 com problema: ${(e as Error).message}` };
  }

  const tpAmb: 1 | 2 = c.ambiente === 1 ? 1 : 2;
  return {
    ok: true,
    ctx: {
      filialId,
      cnpj: fil.cnpj,
      cfg: c,
      tpAmb,
      serie: c.serie && c.serie > 0 ? c.serie : 3,
      cUF,
      csc:
        tpAmb === 1
          ? { id: c.cscId!, token: c.cscToken! }
          : { id: c.cscIdHom!, token: c.cscTokenHom! },
      pem,
    },
  };
}

function fmtDataBr(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return null;
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(brt.getUTCDate())}/${p(brt.getUTCMonth() + 1)}/${brt.getUTCFullYear()} ${p(brt.getUTCHours())}:${p(brt.getUTCMinutes())}:${p(brt.getUTCSeconds())}`;
}

/** Monta a resposta (nota + DANFE nas duas larguras) a partir da linha do banco. */
export function respostaDaNota(row: NfceRow, cfg: FiscalConfig, cnpj: string, jaExistia: boolean) {
  const e = cfg.endereco!;
  const dados = {
    razaoSocial: cfg.razaoSocial ?? '',
    nomeFantasia: cfg.nomeFantasia ?? null,
    cnpj,
    ie: cfg.ie ?? '',
    endereco: `${e.logradouro}, ${e.numero}${e.bairro ? ' - ' + e.bairro : ''} - ${e.municipio}/${e.uf}`,
    ambiente: row.ambiente,
    serie: row.serie,
    numero: row.numero,
    chave: row.chave,
    protocolo: row.protocolo,
    autorizadaEm: fmtDataBr(row.autorizadaEm),
    emitidaEm: fmtDataBr(row.autorizadaEm ?? row.criadoEm),
    destDocumento: row.destDocumento,
    itens: row.itens,
    pagamentos: row.pagamentos,
    valorDesconto: Number(row.valorDesconto),
    valorOutro: Number(row.valorOutro),
    valorTotal: Number(row.valorTotal),
    valorTroco: Math.max(
      0,
      Math.round(
        (row.pagamentos.reduce((s, p) => s + p.valor, 0) - Number(row.valorTotal)) * 100,
      ) / 100,
    ),
    qrcode: row.qrcode,
    urlChave: row.urlChave,
    mesa: row.mesa,
    infoExtra: row.infoExtra,
    cancelada: row.status === 'CANCELADA',
  };
  return {
    ok: true as const,
    jaExistia,
    nota: {
      id: row.id,
      chave: row.chave,
      numero: row.numero,
      serie: row.serie,
      ambiente: row.ambiente,
      protocolo: row.protocolo,
      valorTotal: Number(row.valorTotal),
      destDocumento: row.destDocumento,
      status: row.status,
    },
    danfe32: montarDanfeBlocos(dados, 32),
    danfe48: montarDanfeBlocos(dados, 48),
  };
}

/** Compõe o nfeProc (NFe assinada + protNFe) — o XML de guarda legal. */
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

async function marcarAutorizada(rowId: string, prot: ProtocoloNfce, nfeAssinada: string | null) {
  await db
    .update(schema.nfceEmitida)
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
    .where(eq(schema.nfceEmitida.id, rowId));
}

/** Aloca o próximo número da série (atômico — upsert com incremento). */
async function alocarNumero(filialId: string, serie: number, ambiente: number): Promise<number> {
  const [r] = await db
    .insert(schema.nfceNumeracao)
    .values({ filialId, serie, ambiente, ultimoNumero: 1 })
    .onConflictDoUpdate({
      target: [
        schema.nfceNumeracao.filialId,
        schema.nfceNumeracao.serie,
        schema.nfceNumeracao.ambiente,
      ],
      set: { ultimoNumero: dsql`${schema.nfceNumeracao.ultimoNumero} + 1` },
    })
    .returning({ numero: schema.nfceNumeracao.ultimoNumero });
  if (!r) throw new Error('falha alocando número da NFC-e');
  return r.numero;
}

export async function emitirNfcePedido(
  filialId: string,
  input: EmitirInput,
  tentativa = 0,
): Promise<EmitirResultado> {
  const ctxR = await contextoFiscal(filialId);
  if (!ctxR.ok) return { ok: false, erro: ctxR.erro, pendencias: ctxR.pendencias };
  const ctx = ctxR.ctx;

  // documento do consumidor (o vendas-local já validou; revalida por segurança)
  let doc: string | null = null;
  if (input.documento) {
    const v = validarDocumento(input.documento);
    if (!v) return { ok: false, erro: `CPF/CNPJ inválido: ${formatarDocumento(input.documento)}` };
    doc = v.doc;
  }

  // nota "viva" existente pro pedido?
  const [viva] = await db
    .select()
    .from(schema.nfceEmitida)
    .where(
      and(
        eq(schema.nfceEmitida.filialId, filialId),
        eq(schema.nfceEmitida.pedidoChave, input.pedidoChave),
        inArray(schema.nfceEmitida.status, ['PENDENTE', 'AUTORIZADA']),
      ),
    )
    .orderBy(desc(schema.nfceEmitida.criadoEm))
    .limit(1);

  if (viva?.status === 'AUTORIZADA') {
    return respostaDaNota(viva, ctx.cfg, ctx.cnpj, true);
  }

  if (viva?.status === 'PENDENTE') {
    // tentativa anterior morreu no meio (timeout?) — consulta antes de reenviar
    try {
      const cons = await consultarChave({ chave: viva.chave, tpAmb: ctx.tpAmb, pem: ctx.pem });
      if (cons.cStat === '100' && cons.prot) {
        await marcarAutorizada(viva.id, cons.prot, viva.xml);
        const [atual] = await db
          .select()
          .from(schema.nfceEmitida)
          .where(eq(schema.nfceEmitida.id, viva.id))
          .limit(1);
        return respostaDaNota(atual!, ctx.cfg, ctx.cnpj, true);
      }
      // não consta / rejeitada antes: segue pro reenvio com a MESMA linha
    } catch {
      // consulta falhou (rede) — não arrisca duplicar: devolve erro suave
      return { ok: false, erro: 'SEFAZ instável agora — tente de novo em instantes' };
    }
  }

  // linha reaproveitável (PENDENTE não-autorizada, REJEITADA ou ERRO)?
  let reuso: NfceRow | null = viva ?? null;
  if (!reuso) {
    const [antiga] = await db
      .select()
      .from(schema.nfceEmitida)
      .where(
        and(
          eq(schema.nfceEmitida.filialId, filialId),
          eq(schema.nfceEmitida.pedidoChave, input.pedidoChave),
          inArray(schema.nfceEmitida.status, ['REJEITADA', 'ERRO']),
        ),
      )
      .orderBy(desc(schema.nfceEmitida.criadoEm))
      .limit(1);
    // só reusa o número se série/ambiente não mudaram desde então
    if (antiga && antiga.serie === ctx.serie && antiga.ambiente === ctx.tpAmb) reuso = antiga;
  }

  // número: reusa o alocado SÓ se série/ambiente continuam os mesmos (mudou a
  // config no meio? número novo do contador certo — o velho fica pra inutilizar)
  const numero =
    reuso && reuso.serie === ctx.serie && reuso.ambiente === ctx.tpAmb
      ? reuso.numero
      : await alocarNumero(filialId, ctx.serie, ctx.tpAmb);

  // monta + assina
  let montado;
  try {
    montado = montarXmlNfce({
      config: ctx.cfg,
      cnpjEmitente: ctx.cnpj,
      tpAmb: ctx.tpAmb,
      serie: ctx.serie,
      numero,
      destDocumento: doc,
      itens: input.itens.map((i) => ({
        codigo: i.codigo,
        descricao: i.descricao,
        quantidade: i.quantidade,
        valorTotal: i.valorTotal,
        valorDesconto: i.valorDesconto,
        valorOutro: i.valorOutro,
        unidade: i.unidade,
        ncm: i.ncm,
        cfop: i.cfop,
        csosn: i.csosn,
        origem: i.origem,
      })),
      pagamentos: input.pagamentos.map((p) => ({
        tPag: p.tPag,
        valor: p.valor,
        tBand: p.tBand,
        cAut: p.cAut,
      })),
      valorTroco: input.valorTroco,
      infoExtra: input.infoExtra,
    });
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }

  const { qrcode, urlChave } = montarQrCode({
    uf: ctx.cfg.endereco!.uf,
    chave: montado.chave,
    tpAmb: ctx.tpAmb,
    cscId: ctx.csc.id,
    cscToken: ctx.csc.token,
  });

  let nfeAssinada: string;
  try {
    nfeAssinada = assinarNfe(inserirSupl(montado.nfeSemSupl, qrcode, urlChave), ctx.pem);
  } catch (e) {
    return { ok: false, erro: `falha assinando XML: ${(e as Error).message}` };
  }

  const valores = {
    ambiente: ctx.tpAmb,
    serie: ctx.serie,
    numero,
    chave: montado.chave,
    cnf: montado.cnf,
    status: 'PENDENTE',
    cstat: null as string | null,
    xmotivo: null as string | null,
    mesa: input.mesa ?? null,
    destDocumento: doc,
    valorTotal: String(montado.totais.vNF),
    valorDesconto: String(montado.totais.vDesc),
    valorOutro: String(montado.totais.vOutro),
    itens: input.itens,
    pagamentos: input.pagamentos,
    infoExtra: input.infoExtra ?? null,
    qrcode,
    urlChave,
    xml: nfeAssinada,
    erro: null as string | null,
    solicitadoPor: input.solicitadoPor ?? null,
    atualizadoEm: new Date(),
  };

  let rowId: string;
  if (reuso) {
    await db.update(schema.nfceEmitida).set(valores).where(eq(schema.nfceEmitida.id, reuso.id));
    rowId = reuso.id;
  } else {
    const inseridos = await db
      .insert(schema.nfceEmitida)
      .values({ filialId, pedidoChave: input.pedidoChave, ...valores })
      .onConflictDoNothing()
      .returning({ id: schema.nfceEmitida.id });
    if (!inseridos[0]) {
      // corrida: outra emissão do mesmo pedido entrou primeiro — reprocessa uma vez
      if (tentativa >= 1) return { ok: false, erro: 'emissão simultânea do mesmo pedido — tente de novo' };
      return emitirNfcePedido(filialId, input, tentativa + 1);
    }
    rowId = inseridos[0].id;
  }

  // transmite (síncrono)
  let retorno;
  try {
    retorno = await enviarNfce({ nfeAssinada, tpAmb: ctx.tpAmb, pem: ctx.pem });
  } catch (e) {
    await db
      .update(schema.nfceEmitida)
      .set({ erro: (e as Error).message.slice(0, 500), atualizadoEm: new Date() })
      .where(eq(schema.nfceEmitida.id, rowId));
    return {
      ok: false,
      erro: 'SEFAZ não respondeu — a nota NÃO foi perdida; tente emitir de novo que o sistema confere antes de reenviar',
    };
  }

  const prot = retorno.prot;

  if (prot?.cStat === '100') {
    await marcarAutorizada(rowId, prot, nfeAssinada);
    const [atual] = await db
      .select()
      .from(schema.nfceEmitida)
      .where(eq(schema.nfceEmitida.id, rowId))
      .limit(1);
    return respostaDaNota(atual!, ctx.cfg, ctx.cnpj, false);
  }

  // 204 = duplicidade (a chave JÁ está lá — envio anterior chegou): adota
  const cstatRej = prot?.cStat ?? retorno.cStatLote;
  const xmotivoRej = prot?.xMotivo ?? retorno.xMotivoLote;
  if (cstatRej === '204') {
    try {
      const cons = await consultarChave({ chave: montado.chave, tpAmb: ctx.tpAmb, pem: ctx.pem });
      if (cons.cStat === '100' && cons.prot) {
        await marcarAutorizada(rowId, cons.prot, nfeAssinada);
        const [atual] = await db
          .select()
          .from(schema.nfceEmitida)
          .where(eq(schema.nfceEmitida.id, rowId))
          .limit(1);
        return respostaDaNota(atual!, ctx.cfg, ctx.cnpj, true);
      }
    } catch {
      /* cai na rejeição normal */
    }
  }

  await db
    .update(schema.nfceEmitida)
    .set({
      status: 'REJEITADA',
      cstat: cstatRej || null,
      xmotivo: xmotivoRej || null,
      atualizadoEm: new Date(),
    })
    .where(eq(schema.nfceEmitida.id, rowId));

  return {
    ok: false,
    cstat: cstatRej,
    erro: `SEFAZ rejeitou (${cstatRej}): ${xmotivoRej}`,
  };
}
