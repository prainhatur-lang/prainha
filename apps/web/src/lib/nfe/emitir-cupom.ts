// Conversor de cupom em nota: emite a NF-e (modelo 55) a partir de uma NFC-e
// (modelo 65) JÁ AUTORIZADA, pro cliente que pede a nota no CNPJ/CPF dele.
//
// O cupom continua válido — a NF-e sai com CFOP 5929 referenciando a chave
// dele (ver xml-cupom.ts). Mesmo transporte e mesmas travas da NF-e de
// transferência (emitir.ts):
//
// Idempotente por (cupom, ambiente): AUTORIZADA devolve a mesma nota; PENDENTE
// consulta a chave na SEFAZ antes de reenviar; REJEITADA/ERRO reusa o número.

import { db, schema } from '@concilia/db';
import type { NfeDestinatarioSnapshot } from '@concilia/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { contextoFiscal } from '@/lib/nfce/emitir';
import { assinarNfe } from '@/lib/nfce/assinar';
import { enviarNfce, consultarChave } from '@/lib/nfce/sefaz';
import { validarDocumento } from '@/lib/nfce/documento';
import { pendenciasNfe, regimeNfe } from './xml';
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
import { itensDoXmlDoCupom, montarXmlNfeCupom, pendenciasDestinatario, type NfeCupomItem } from './xml-cupom';

type NfeRow = typeof schema.nfeEmitida.$inferSelect;

const so = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');
const limpo = (s: string | null | undefined, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Arruma o que veio do formulário (só dígitos onde é número, UF maiúscula). */
export function normalizarDestinatario(d: Partial<NfeDestinatarioSnapshot>): NfeDestinatarioSnapshot {
  return {
    documento: so(d.documento),
    nome: limpo(d.nome, 60),
    ...(so(d.ie) ? { ie: so(d.ie) } : {}),
    ...(limpo(d.email, 60) ? { email: limpo(d.email, 60) } : {}),
    logradouro: limpo(d.logradouro, 60),
    numero: limpo(d.numero, 60) || 'SN',
    ...(limpo(d.complemento, 60) ? { complemento: limpo(d.complemento, 60) } : {}),
    bairro: limpo(d.bairro, 60),
    codigoMunicipio: so(d.codigoMunicipio),
    municipio: limpo(d.municipio, 60),
    uf: limpo(d.uf, 2).toUpperCase(),
    cep: so(d.cep),
    ...(so(d.fone) ? { fone: so(d.fone) } : {}),
  };
}

/**
 * Guarda o cadastro do cliente do jeito que foi conferido na tela (por empresa),
 * pra próxima busca do CPF/CNPJ já trazer certo. Nunca derruba a emissão.
 */
export async function salvarDestinatario(filialId: string, dest: NfeDestinatarioSnapshot, userId: string): Promise<void> {
  try {
    const [f] = await db
      .select({ org: schema.filial.organizacaoId })
      .from(schema.filial)
      .where(eq(schema.filial.id, filialId))
      .limit(1);
    if (!f) return;
    await db
      .insert(schema.nfeDestinatario)
      .values({ organizacaoId: f.org, documento: dest.documento, dados: dest, atualizadoPor: userId })
      .onConflictDoUpdate({
        target: [schema.nfeDestinatario.organizacaoId, schema.nfeDestinatario.documento],
        set: { dados: dest, atualizadoPor: userId, atualizadoEm: new Date() },
      });
  } catch (e) {
    console.error('[nfe] salvarDestinatario', (e as Error).message);
  }
}

/** Rejeições da SEFAZ pra NF-e que referencia NFC-e (modelo 65). */
const REJ_REFERENCIA = new Set(['679', '375']);
const AVISO_TESTE_SEM_REF =
  'Teste autorizado SEM a referência ao cupom: o ambiente de teste da SEFAZ já recusa NF-e que aponta pra NFC-e ' +
  '(rejeição 679, regra que entra em produção em 14/12/2026). O resto da nota passou. A nota de verdade vai COM a referência.';

const dataBr = (d: Date | null) =>
  d ? d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';

export async function emitirNfeDoCupom(
  opts: {
    nfceId: string;
    userId: string;
    destinatario: Partial<NfeDestinatarioSnapshot>;
    homologacao?: boolean;
    /** Uso interno: reenvio do TESTE sem <NFref> depois da rejeição 679/375. */
    semReferencia?: boolean;
  },
  tentativa = 0,
  trocasSerie = 0,
): Promise<EmitirNfeResultado> {
  const [cupom] = await db.select().from(schema.nfceEmitida).where(eq(schema.nfceEmitida.id, opts.nfceId)).limit(1);
  if (!cupom) return { ok: false, erro: 'cupom não encontrado' };
  if (!(await temAcesso(opts.userId, cupom.filialId))) return { ok: false, erro: 'sem acesso à casa que emitiu o cupom' };
  if (cupom.status !== 'AUTORIZADA') {
    return { ok: false, erro: `só cupom AUTORIZADO vira NF-e (este está ${cupom.status})` };
  }

  const ctxR = await contextoFiscal(cupom.filialId, { paraEmitir: false });
  if (!ctxR.ok) return { ok: false, erro: ctxR.erro };
  const ctx = ctxR.ctx;
  const pe = pendenciasNfe(ctx.cfg);
  if (pe.length) return { ok: false, erro: `config fiscal da casa incompleta: ${pe.join('; ')}` };

  const { tpAmb } = parametrosNfe(ctx.cfg, opts.homologacao === true);
  // Nota de verdade só de cupom de verdade.
  if (tpAmb === 1 && cupom.ambiente !== 1) {
    return { ok: false, erro: 'este cupom é de homologação (teste) — não vira NF-e de produção' };
  }

  const dest = normalizarDestinatario(opts.destinatario);
  const docOk = validarDocumento(dest.documento);
  if (!docOk) return { ok: false, erro: 'CPF/CNPJ do cliente inválido' };
  dest.documento = docOk.doc;
  const pd = pendenciasDestinatario(dest);
  if (pd.length) return { ok: false, erro: `falta no cadastro do cliente: ${pd.join('; ')}` };
  if (dest.documento === ctx.cnpj.replace(/\D/g, '')) {
    return { ok: false, erro: 'o cliente tem o mesmo CNPJ da casa — não cabe nota fiscal pra ela mesma' };
  }

  // cadastro conferido fica guardado (teste ou nota de verdade)
  if (tentativa === 0 && trocasSerie === 0 && !opts.semReferencia) await salvarDestinatario(cupom.filialId, dest, opts.userId);

  const serie = await serieEmUso(cupom.filialId, ctx.cfg, tpAmb);
  const modelo = 55 as const;
  const semReferencia = opts.semReferencia === true || ctx.cfg?.nfe?.cupomSemReferencia === true;

  // nota "viva" desse cupom nesse ambiente?
  const [viva] = await db
    .select()
    .from(schema.nfeEmitida)
    .where(
      and(
        eq(schema.nfeEmitida.nfceOrigemId, cupom.id),
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
          eq(schema.nfeEmitida.nfceOrigemId, cupom.id),
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
      : await alocarNumero(cupom.filialId, serie, tpAmb);

  // Itens: os do XML autorizado (o que a SEFAZ tem); sem XML, o snapshot.
  let itens: NfeCupomItem[] = itensDoXmlDoCupom(cupom.xml);
  if (!itens.length) {
    itens = (cupom.itens ?? []).map((i) => ({
      codigo: i.codigo,
      descricao: i.descricao,
      unidade: i.unidade ?? 'UN',
      quantidade: i.quantidade,
      valorTotal: i.valorTotal,
      valorDesconto: i.valorDesconto ?? 0,
      valorOutro: i.valorOutro ?? 0,
      ncm: i.ncm ?? null,
      origem: i.origem ?? null,
      csosn: i.csosn ?? null,
    }));
  }

  const infoExtra =
    `NF-e emitida em decorrencia do cupom fiscal eletronico (NFC-e) n. ${cupom.numero} serie ${cupom.serie}` +
    `${cupom.autorizadaEm ? ` de ${dataBr(cupom.autorizadaEm)}` : ''}, chave ${cupom.chave}. ` +
    `Operacao ja registrada e tributada no cupom referenciado; pagamento recebido no cupom. ` +
    (regimeNfe(ctx.cfg) === 3
      ? `Sem novo destaque de imposto.`
      : `Documento emitido por ME ou EPP optante pelo Simples Nacional. Nao gera direito a credito fiscal de IPI.`);

  let montado;
  try {
    montado = montarXmlNfeCupom({
      emitente: ctx.cfg,
      cnpjEmitente: ctx.cnpj,
      destinatario: dest,
      tpAmb,
      serie,
      numero,
      chaveCupom: cupom.chave,
      semReferencia,
      itens,
      infoExtra,
    });
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
  // A nota tem que fechar no centavo com o cupom.
  if (Math.abs(montado.vNF - Number(cupom.valorTotal)) > 0.005) {
    return {
      ok: false,
      erro: `os itens somam ${montado.vNF.toFixed(2)} e o cupom é de ${Number(cupom.valorTotal).toFixed(2)} — nota não emitida`,
    };
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
    chaveReferenciada: cupom.chave,
    dest,
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
      .values({ filialId: cupom.filialId, nfceOrigemId: cupom.id, ...valores })
      .onConflictDoNothing()
      .returning({ id: schema.nfeEmitida.id });
    if (!inseridos[0]) {
      // corrida: outro clique entrou primeiro — reprocessa uma vez
      if (tentativa >= 1) return { ok: false, erro: 'emissão simultânea da mesma nota — tente de novo' };
      return emitirNfeDoCupom(opts, tentativa + 1, trocasSerie);
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
    return {
      ok: true,
      jaExistia: false,
      nota: resumo(await marcarAutorizada(rowId, prot, nfeAssinada)),
      ...(opts.semReferencia ? { aviso: AVISO_TESTE_SEM_REF } : {}),
    };
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
        .values({ filialId: cupom.filialId, serie: serie + 1, ambiente: tpAmb, ultimoNumero: 0 })
        .onConflictDoNothing();
      return emitirNfeDoCupom(opts, 0, trocasSerie + 1);
    }
    return {
      ok: false,
      cstat: cstatRej,
      erro: `SEFAZ rejeitou (539): a série ${serie} da NF-e desta casa já tem o número ${numero} emitido por outro sistema. ${xmotivoRej}`,
    };
  }
  // 679/375 = a SEFAZ não aceitou a NF-e apontar pra uma NFC-e (NT 2026.002,
  // regra BA02-35). No TESTE a regra já vale; em produção, só de 14/12/2026 em
  // diante. No teste reenvia sem a referência, pra conferir o resto da nota.
  if (REJ_REFERENCIA.has(cstatRej ?? '') && !semReferencia) {
    if (tpAmb === 2) return emitirNfeDoCupom({ ...opts, semReferencia: true }, 0, trocasSerie);
    return {
      ok: false,
      cstat: cstatRej,
      erro:
        `SEFAZ rejeitou (${cstatRej}): ${xmotivoRej} — a SEFAZ não aceita mais NF-e que referencia cupom (NFC-e) ` +
        `(NT 2026.002). Fale com o contador: daqui pra frente o CNPJ do cliente vai no próprio cupom.`,
    };
  }
  return { ok: false, cstat: cstatRej, erro: `SEFAZ rejeitou (${cstatRej}): ${xmotivoRej}` };
}

/** Todas as NF-e já pedidas pra um cupom (mais nova primeiro). */
export async function nfesDoCupom(nfceId: string): Promise<NfeRow[]> {
  return db
    .select()
    .from(schema.nfeEmitida)
    .where(eq(schema.nfeEmitida.nfceOrigemId, nfceId))
    .orderBy(desc(schema.nfeEmitida.criadoEm));
}

/** Por cupom, a NF-e de PRODUÇÃO que está valendo (autorizada) — pra lista. */
export async function nfeValendoPorCupom(nfceIds: string[]): Promise<Map<string, { id: string; numero: number; serie: number }>> {
  const out = new Map<string, { id: string; numero: number; serie: number }>();
  if (!nfceIds.length) return out;
  const rows = await db
    .select({
      id: schema.nfeEmitida.id,
      numero: schema.nfeEmitida.numero,
      serie: schema.nfeEmitida.serie,
      nfceOrigemId: schema.nfeEmitida.nfceOrigemId,
    })
    .from(schema.nfeEmitida)
    .where(
      and(
        inArray(schema.nfeEmitida.nfceOrigemId, nfceIds),
        eq(schema.nfeEmitida.ambiente, 1),
        eq(schema.nfeEmitida.status, 'AUTORIZADA'),
      ),
    );
  for (const r of rows) if (r.nfceOrigemId) out.set(r.nfceOrigemId, { id: r.id, numero: r.numero, serie: r.serie });
  return out;
}
