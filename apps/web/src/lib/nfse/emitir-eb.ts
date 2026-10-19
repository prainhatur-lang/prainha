// Emite na NFS-e Nacional a nota de uma fatura_servico da E.B. (19/10/2026).
//
// Fluxo: monta a DPS → assina com o A1 da E.B. → POST /nfse na Sefin Nacional
// → grava chave, número e XML da NFS-e na fatura (status EMITIDA), ou o erro.
//
// Número da DPS: reservado uma vez por fatura (fatura.nfse_numero_dps). Se a
// tentativa falhar, a próxima reusa o mesmo número — se a primeira na verdade
// passou (timeout), a Sefin acusa DPS repetida em vez de gerar nota dobrada.

import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { findActiveCertForFilial } from '@/lib/certificado-resolver';
import { decifrarSenha } from '@/lib/certificado';
import { extrairPem, type PemCert } from '@/lib/sefaz-evento';
import { assinarDps, idDps, montarDps } from './dps';
import { chamarSefin, gunzipB64, gzipB64, type AmbienteNfse } from './sefin';
import { TOMADOR_FIXO } from '@/lib/eb/faturas';

type FiscalEnd = {
  cep?: string;
  bairro?: string;
  numero?: string;
  logradouro?: string;
  codigoMunicipio?: string;
};

export type ResultadoEmissao =
  | { ok: true; chave: string; numero: string | null; alertas: string[] }
  | { ok: false; erro: string };

/** Agora em Brasília, 1 min atrás (a Sefin recusa dhEmi no futuro). */
function dhEmiAgora(): string {
  const d = new Date(Date.now() - 3 * 3600_000 - 60_000);
  return d.toISOString().slice(0, 19) + '-03:00';
}

function ultimoDiaCompetencia(comp: string): string {
  const [a, m] = comp.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
  return `${comp}-${String(ultimo).padStart(2, '0')}`;
}

export async function carregarPemEb(filialEbId: string): Promise<PemCert | string> {
  const cert = await findActiveCertForFilial(filialEbId);
  if (!cert) return 'A E.B. ainda não tem certificado A1 — suba o .pfx no topo desta tela.';
  try {
    const admin = await createAdminClient();
    const { data, error } = await admin.storage.from('certificados').download(cert.pfxStoragePath);
    if (error || !data) return `erro baixando o certificado: ${error?.message ?? 'arquivo sumiu'}`;
    return extrairPem(Buffer.from(await data.arrayBuffer()), decifrarSenha(cert.senhaCifrada));
  } catch (e) {
    return `certificado A1 com problema: ${(e as Error).message}`;
  }
}

/** Mensagens de erro da Sefin (o formato varia entre erros[] e erro{}). */
function lerErros(j: Record<string, unknown> | null, texto: string, status: number): string {
  if (j) {
    const lista = (j.erros ?? j.Erros ?? (j.erro ? [j.erro] : null)) as unknown;
    if (Array.isArray(lista) && lista.length > 0) {
      return lista
        .map((e) => {
          const o = e as Record<string, unknown>;
          const cod = o.Codigo ?? o.codigo ?? '';
          const desc = o.Descricao ?? o.descricao ?? '';
          const comp = o.Complemento ?? o.complemento ?? '';
          return [cod, desc, comp].filter(Boolean).join(' — ');
        })
        .join(' | ');
    }
    const msg = j.message ?? j.mensagem ?? j.title;
    if (msg) return `HTTP ${status}: ${String(msg)}`;
  }
  return `HTTP ${status}: ${texto.replace(/\s+/g, ' ').slice(0, 300)}`;
}

export async function emitirNfseFatura(faturaId: string): Promise<ResultadoEmissao> {
  const [fat] = await db.select().from(schema.faturaServico).where(eq(schema.faturaServico.id, faturaId)).limit(1);
  if (!fat) return { ok: false, erro: 'fatura não encontrada' };
  if (fat.status === 'EMITIDA') return { ok: false, erro: 'NFS-e já emitida' };
  if (fat.status === 'CANCELADA') return { ok: false, erro: 'fatura cancelada' };

  const [cfg] = await db.select().from(schema.nfseConfig).where(eq(schema.nfseConfig.filialId, fat.filialId)).limit(1);
  if (!cfg) return { ok: false, erro: 'configuração da NFS-e da E.B. não encontrada' };

  const [casa] = await db
    .select({ cnpj: schema.filial.cnpj, nome: schema.filial.nome, fiscal: schema.filial.fiscalConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, fat.tomadorFilialId))
    .limit(1);
  if (!casa?.cnpj) return { ok: false, erro: 'casa tomadora sem CNPJ' };
  const fiscal = (casa.fiscal ?? {}) as { razaoSocial?: string; endereco?: FiscalEnd };
  const end = TOMADOR_FIXO[fat.tomadorFilialId] ?? fiscal.endereco ?? {};
  if (!end.codigoMunicipio || !end.cep || !end.logradouro || !end.bairro) {
    return { ok: false, erro: `endereço fiscal de ${casa.nome} incompleto (Configurações → Fiscal)` };
  }

  const pem = await carregarPemEb(fat.filialId);
  if (typeof pem === 'string') return { ok: false, erro: pem };

  // Reserva o número da DPS (uma vez por fatura).
  let nDps = fat.nfseNumeroDps;
  if (!nDps) {
    const [r] = await db
      .update(schema.nfseConfig)
      .set({ proximoNumeroDps: sql`${schema.nfseConfig.proximoNumeroDps} + 1` })
      .where(eq(schema.nfseConfig.filialId, cfg.filialId))
      .returning({ usado: sql<number>`${schema.nfseConfig.proximoNumeroDps} - 1` });
    nDps = r!.usado;
    await db.update(schema.faturaServico).set({ nfseNumeroDps: nDps }).where(eq(schema.faturaServico.id, fat.id));
  }

  const ambiente: AmbienteNfse = cfg.ambiente === 'homologacao' ? 'homologacao' : 'producao';
  const dados = {
    tpAmb: (ambiente === 'producao' ? 1 : 2) as 1 | 2,
    dhEmi: dhEmiAgora(),
    serie: cfg.serieDps,
    nDps,
    dCompet: ultimoDiaCompetencia(fat.competencia),
    prestador: {
      cnpj: cfg.cnpj,
      im: cfg.inscricaoMunicipal as string | null,
      codigoMunicipio: cfg.codigoMunicipio,
      regApTribSN: 1 as const,
    },
    tomador: {
      cnpj: casa.cnpj,
      nome: fiscal.razaoSocial || casa.nome,
      codigoMunicipio: end.codigoMunicipio,
      cep: end.cep,
      logradouro: end.logradouro,
      numero: end.numero || 'S/N',
      bairro: end.bairro,
    },
    codigoTributacao: cfg.codigoTributacao,
    descricao: fat.discriminacao,
    municipioPrestacao: end.codigoMunicipio,
    valorServico: Number(fat.valorServico),
    aliquotaIss: Number(fat.aliquotaIss),
    issRetido: fat.issRetido,
    percentualTributosSN: null,
  };

  // Envia; se Aracaju disser que a IM não pode ir (E0120 — CNPJ sem cadastro
  // complementar no CNC), reenvia uma vez sem ela (DPS rejeitada não gasta número).
  const agora = new Date();
  let assinado = '';
  let resp: Awaited<ReturnType<typeof chamarSefin>> | null = null;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      assinado = assinarDps(montarDps(dados), pem);
    } catch (e) {
      return { ok: false, erro: `erro assinando a DPS: ${(e as Error).message}` };
    }
    try {
      resp = await chamarSefin({
        ambiente,
        metodo: 'POST',
        caminho: '/nfse',
        corpo: { dpsXmlGZipB64: gzipB64(assinado) },
        pem,
      });
    } catch (e) {
      const erro = `Sefin Nacional fora: ${(e as Error).message}. Tente de novo (o número da DPS é o mesmo).`;
      await db.update(schema.faturaServico).set({ nfseErro: erro, atualizadoEm: agora }).where(eq(schema.faturaServico.id, fat.id));
      return { ok: false, erro };
    }
    const semIm = resp.status >= 400 && dados.prestador.im && /E0120/.test(resp.texto);
    if (!semIm) break;
    dados.prestador = { ...dados.prestador, im: null };
  }
  if (!resp) return { ok: false, erro: 'sem resposta da Sefin' };

  const j = resp.json;
  const chave = (j?.chaveAcesso ?? j?.ChaveAcesso) as string | undefined;
  const nfseGz = (j?.nfseXmlGZipB64 ?? j?.NfseXmlGZipB64) as string | undefined;
  if (resp.status >= 200 && resp.status < 300 && chave) {
    const xml = nfseGz ? gunzipB64(nfseGz) : assinado;
    const numero = xml.match(/<nNFSe>(\d+)<\/nNFSe>/)?.[1] ?? null;
    const alertas = Array.isArray(j?.alertas)
      ? (j!.alertas as Array<Record<string, unknown>>).map((a) => `${a.Codigo ?? a.codigo ?? ''} ${a.Descricao ?? a.descricao ?? ''}`.trim())
      : [];
    await db
      .update(schema.faturaServico)
      .set({
        status: 'EMITIDA',
        nfseChave: chave,
        nfseNumero: numero,
        nfseEmitidaEm: agora,
        nfseXml: xml,
        nfseErro: null,
        atualizadoEm: agora,
      })
      .where(eq(schema.faturaServico.id, fat.id));
    return { ok: true, chave, numero, alertas };
  }

  const erro = lerErros(j, resp.texto, resp.status);
  await db
    .update(schema.faturaServico)
    .set({ nfseErro: `${idDps(dados)}: ${erro}`.slice(0, 4000), atualizadoEm: agora })
    .where(eq(schema.faturaServico.id, fat.id));
  return { ok: false, erro };
}
