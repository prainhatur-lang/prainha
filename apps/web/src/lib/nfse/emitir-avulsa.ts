// NFS-e Nacional AVULSA: nota de serviço pra empresa de FORA do sistema
// (pedido do dono 11/11/2026). Mesmo caminho da nota das casas
// (lib/nfse/emitir-eb.ts): monta a DPS → assina com o A1 do emitente → POST
// /nfse na Sefin → grava chave, número e XML na nfse_avulsa, ou o erro.
//
// Nada de enquadramento é escolhido aqui: código de tributação, alíquota e
// retenção vêm do que foi digitado na nota.
// Número da DPS: reservado uma vez por nota na sequência do nfse_config; nova
// tentativa reusa o mesmo (timeout não vira nota dobrada).

import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { assinarDps, idDps, montarDps } from './dps';
import { chamarSefin, gunzipB64, gzipB64, type AmbienteNfse } from './sefin';
import { carregarPemEb, dhEmiAgora, lerErros, type ResultadoEmissao } from './emitir-eb';
import { hojeBr } from '@/lib/datas';

export type EnderecoCnpj = {
  razaoSocial: string;
  email: string | null;
  codigoMunicipio: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  situacao: string | null;
};

/** Razão social e endereço pelo CNPJ (BrasilAPI, reserva Minha Receita) — só
 *  pra preencher o formulário; quem emite confere e corrige. */
export async function buscarEnderecoCnpj(cnpj: string): Promise<EnderecoCnpj | null> {
  const doc = cnpj.replace(/\D/g, '');
  if (doc.length !== 14) return null;
  for (const base of ['https://brasilapi.com.br/api/cnpj/v1/', 'https://minhareceita.org/']) {
    try {
      const r = await fetch(`${base}${doc}`, {
        headers: { 'User-Agent': 'concilia/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const c = (await r.json()) as Record<string, unknown>;
      const s = (k: string, max: number) => {
        const v = c[k];
        const t = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
        return t ? t.slice(0, max) : null;
      };
      const razaoSocial = s('razao_social', 300);
      if (!razaoSocial) continue;
      const ibge = (s('codigo_municipio_ibge', 10) ?? '').replace(/\D/g, '');
      const tipo = s('descricao_tipo_de_logradouro', 30);
      const lgr = s('logradouro', 220);
      return {
        razaoSocial,
        email: s('email', 80)?.toLowerCase() ?? null,
        codigoMunicipio: ibge.length === 7 ? ibge : null,
        cidade: s('municipio', 120),
        uf: s('uf', 2)?.toUpperCase() ?? null,
        cep: (s('cep', 12) ?? '').replace(/\D/g, '') || null,
        logradouro: lgr ? [tipo, lgr].filter(Boolean).join(' ') : null,
        numero: s('numero', 60),
        bairro: s('bairro', 60),
        situacao: s('descricao_situacao_cadastral', 40),
      };
    } catch {
      /* tenta a próxima */
    }
  }
  return null;
}

export async function emitirNfseAvulsa(notaId: string): Promise<ResultadoEmissao> {
  const [n] = await db.select().from(schema.nfseAvulsa).where(eq(schema.nfseAvulsa.id, notaId)).limit(1);
  if (!n) return { ok: false, erro: 'nota não encontrada' };
  if (n.status === 'EMITIDA') return { ok: false, erro: 'NFS-e já emitida' };
  if (n.status === 'CANCELADA') return { ok: false, erro: 'nota descartada' };
  if (n.issRetido && n.aliquotaIss === null) return { ok: false, erro: 'ISS retido precisa da alíquota' };
  if (n.dataCompetencia > hojeBr()) return { ok: false, erro: 'a data de competência não pode ser no futuro' };

  const [cfg] = await db.select().from(schema.nfseConfig).where(eq(schema.nfseConfig.filialId, n.filialId)).limit(1);
  if (!cfg) return { ok: false, erro: 'essa empresa não tem a NFS-e configurada' };

  const pem = await carregarPemEb(n.filialId);
  if (typeof pem === 'string') return { ok: false, erro: pem };

  let nDps = n.nfseNumeroDps;
  if (!nDps) {
    const [r] = await db
      .update(schema.nfseConfig)
      .set({ proximoNumeroDps: sql`${schema.nfseConfig.proximoNumeroDps} + 1` })
      .where(eq(schema.nfseConfig.filialId, cfg.filialId))
      .returning({ usado: sql<number>`${schema.nfseConfig.proximoNumeroDps} - 1` });
    nDps = r!.usado;
    await db.update(schema.nfseAvulsa).set({ nfseNumeroDps: nDps }).where(eq(schema.nfseAvulsa.id, n.id));
  }

  const ambiente: AmbienteNfse = cfg.ambiente === 'homologacao' ? 'homologacao' : 'producao';
  // Simples sem retenção: a alíquota não vai na nota (E0625), mesmo se o rascunho antigo tiver uma
  const aliquota = !n.issRetido || n.aliquotaIss === null ? null : Number(n.aliquotaIss);
  const dados = {
    tpAmb: (ambiente === 'producao' ? 1 : 2) as 1 | 2,
    dhEmi: dhEmiAgora(),
    serie: cfg.serieDps,
    nDps,
    dCompet: n.dataCompetencia,
    prestador: {
      cnpj: cfg.cnpj,
      im: cfg.inscricaoMunicipal as string | null,
      codigoMunicipio: cfg.codigoMunicipio,
      regApTribSN: 1 as const,
    },
    tomador: {
      cnpj: n.tomadorCnpj,
      nome: n.tomadorNome,
      codigoMunicipio: n.tomadorCodigoMunicipio,
      cep: n.tomadorCep,
      logradouro: n.tomadorLogradouro,
      numero: n.tomadorNumero || 'S/N',
      bairro: n.tomadorBairro,
      email: n.tomadorEmail,
    },
    codigoTributacao: n.codigoTributacao,
    descricao: n.descricao,
    municipioPrestacao: n.municipioPrestacao,
    valorServico: Number(n.valorServico),
    aliquotaIss: aliquota ?? 0,
    issRetido: n.issRetido,
    percentualTributosSN: null,
  };

  const agora = new Date();
  let assinado = '';
  let resp: Awaited<ReturnType<typeof chamarSefin>> | null = null;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      let xml = montarDps(dados);
      // alíquota em branco = a nota vai sem pAliq (Simples sem retenção)
      if (aliquota === null) xml = xml.replace('<pAliq>0.00</pAliq>', '');
      assinado = '<?xml version="1.0" encoding="UTF-8"?>' + assinarDps(xml, pem);
    } catch (e) {
      return { ok: false, erro: `erro assinando a DPS: ${(e as Error).message}` };
    }
    try {
      resp = await chamarSefin({ ambiente, metodo: 'POST', caminho: '/nfse', corpo: { dpsXmlGZipB64: gzipB64(assinado) }, pem });
    } catch (e) {
      const erro = `Sefin Nacional fora: ${(e as Error).message}. Tente de novo (o número da DPS é o mesmo).`;
      await db.update(schema.nfseAvulsa).set({ nfseErro: erro, atualizadoEm: agora }).where(eq(schema.nfseAvulsa.id, n.id));
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
      .update(schema.nfseAvulsa)
      .set({ status: 'EMITIDA', nfseChave: chave, nfseNumero: numero, nfseEmitidaEm: agora, nfseXml: xml, nfseErro: null, atualizadoEm: agora })
      .where(eq(schema.nfseAvulsa.id, n.id));
    return { ok: true, chave, numero, alertas };
  }

  const erro = lerErros(j, resp.texto, resp.status);
  await db
    .update(schema.nfseAvulsa)
    .set({ nfseErro: `${idDps(dados)}: ${erro}`.slice(0, 4000), atualizadoEm: agora })
    .where(eq(schema.nfseAvulsa.id, n.id));
  return { ok: false, erro };
}
