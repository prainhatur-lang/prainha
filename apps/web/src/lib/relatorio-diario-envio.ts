// Envio do relatório diário pelo WhatsApp (Meta Cloud API).
//
// Regra do WhatsApp que manda aqui: texto livre só passa dentro de 24 h da
// última mensagem que o destinatário mandou PRA AQUELE NÚMERO da casa. Fora
// disso só entra modelo (template) aprovado. Então:
//   - janela aberta  → manda o relatório inteiro em texto;
//   - janela fechada → manda o modelo `relatorio_diario` (resumo de uma linha +
//     botão "Ver resumo"); o toque no botão abre a janela e a gente responde
//     com o relatório inteiro.
// A Meta devolve 200 mesmo com a janela fechada (a falha vem depois, no
// webhook de status) — por isso a janela é decidida pelo NOSSO registro
// (`relatorio_diario_envio`, canal 'toque') e a falha de status cai no modelo.

import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { enviarTexto } from '@/lib/atendimento/zap';
import {
  montarRelatorioOrganizacao,
  resumoUmaLinha,
  rotuloDia,
  somaDias,
  textoRelatorio,
  ultimoDiaFechado,
  type RelatorioCasa,
} from './relatorio-diario';
import { dateToBrYmd } from './datas';

const BASE_URL = 'https://app.prainhabar.com';
/** Folga antes das 24 h da Meta: toque de ontem 07:30 ainda vale no cron de hoje 07:00. */
const JANELA_MS = (23 * 60 + 45) * 60 * 1000;

export type OrigemEnvio = 'cron' | 'manual' | 'toque' | 'pedido';

export function linkRelatorio(dia: string): string {
  return `${BASE_URL}/relatorios/diario?dia=${dia}`;
}

export function nomeModelo(): string {
  return process.env.WHATSAPP_RELATORIO_TEMPLATE || 'relatorio_diario';
}

function token(): string {
  return process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META || '';
}

function phoneIdPadrao(): string {
  return process.env.WHATSAPP_PHONE_ID || '';
}

const versaoApi = () => process.env.WHATSAPP_API_VERSION || 'v21.0';
// Mesma conta (WABA) que /api/admin/whatsapp-subscribe usa.
const WABA_PADRAO = '2163799284418471';

async function graphGet<T>(caminho: string): Promise<T | null> {
  try {
    const resp = await fetch(`https://graph.facebook.com/${versaoApi()}/${caminho}`, {
      headers: { Authorization: `Bearer ${token()}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

async function wabaTemNumero(waba: string, phoneId: string): Promise<boolean> {
  const r = await graphGet<{ data?: Array<{ id?: string }> }>(`${waba}/phone_numbers?fields=id&limit=100`);
  return (r?.data ?? []).some((n) => n.id === phoneId);
}

let wabaResolvida: string | null = null;
/**
 * A conta (WABA) dona do número que manda o aviso: o modelo tem que morar
 * nela. Vale a env; sem env, confere a conta padrão e, se o número não for
 * dela, procura nas contas que o token alcança (mesmo caminho do
 * /api/atendimento/numeros-meta).
 */
async function wabaDoRemetente(): Promise<string> {
  if (process.env.WHATSAPP_WABA_ID) return process.env.WHATSAPP_WABA_ID;
  if (wabaResolvida) return wabaResolvida;
  const phoneId = phoneIdPadrao();
  if (!phoneId || (await wabaTemNumero(WABA_PADRAO, phoneId))) {
    wabaResolvida = WABA_PADRAO;
    return WABA_PADRAO;
  }
  const negocios = await graphGet<{ data?: Array<{ id?: string }> }>('me/businesses?fields=id&limit=50');
  for (const n of negocios?.data ?? []) {
    if (!n.id) continue;
    for (const borda of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
      const r = await graphGet<{ data?: Array<{ id?: string }> }>(`${n.id}/${borda}?fields=id&limit=50`);
      for (const w of r?.data ?? []) {
        if (w.id && w.id !== WABA_PADRAO && (await wabaTemNumero(w.id, phoneId))) {
          wabaResolvida = w.id;
          return w.id;
        }
      }
    }
  }
  return WABA_PADRAO;
}

// ---------------------------------------------------------------------------
// Modelo (template) na Meta
// ---------------------------------------------------------------------------

/** Texto do modelo `relatorio_diario` (UTILIDADE, pt_BR). {{1}} = dia, {{2}} = resumo. */
export const TEXTO_MODELO =
  'Relatório de {{1}} pronto.\n\n{{2}}\n\nToque em "Ver resumo" pra receber os detalhes de cada casa aqui na conversa.';
export const BOTAO_MODELO = 'Ver resumo';

export type SituacaoModelo = 'aprovado' | 'em_analise' | 'recusado' | 'nao_existe' | 'indisponivel';
export interface EstadoModelo {
  nome: string;
  situacao: SituacaoModelo;
  detalhe: string | null;
}

/** Como o modelo está na Meta agora (aprovado, em análise, recusado, não existe). */
export async function estadoDoModelo(): Promise<EstadoModelo> {
  const nome = nomeModelo();
  if (!token()) return { nome, situacao: 'indisponivel', detalhe: 'WhatsApp não configurado neste ambiente' };
  try {
    const waba = await wabaDoRemetente();
    const resp = await fetch(
      `https://graph.facebook.com/${versaoApi()}/${waba}/message_templates?name=${encodeURIComponent(nome)}&fields=name,status,language,rejected_reason&limit=50`,
      { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store', signal: AbortSignal.timeout(5000) },
    );
    const json = (await resp.json().catch(() => null)) as
      | { data?: Array<{ name?: string; status?: string; language?: string; rejected_reason?: string }>; error?: { message?: string } }
      | null;
    if (!resp.ok) return { nome, situacao: 'indisponivel', detalhe: json?.error?.message ?? `HTTP ${resp.status}` };
    // `name` na Meta é "contém" — fica só o nome exato, de preferência em pt_BR.
    const iguais = (json?.data ?? []).filter((t) => t.name === nome);
    const t = iguais.find((x) => x.language === 'pt_BR') ?? iguais[0];
    if (!t) return { nome, situacao: 'nao_existe', detalhe: null };
    const st = (t.status ?? '').toUpperCase();
    if (st === 'APPROVED') return { nome, situacao: 'aprovado', detalhe: null };
    if (st === 'PENDING' || st === 'IN_APPEAL') return { nome, situacao: 'em_analise', detalhe: null };
    const motivo = t.rejected_reason && t.rejected_reason !== 'NONE' ? ` (${t.rejected_reason})` : '';
    return { nome, situacao: 'recusado', detalhe: `${st}${motivo}` };
  } catch (e) {
    return { nome, situacao: 'indisponivel', detalhe: e instanceof Error ? e.message : String(e) };
  }
}

/** Cria o modelo na Meta (o dono aperta o botão na tela). Depois é só esperar a aprovação. */
export async function criarModelo(): Promise<EstadoModelo> {
  const nome = nomeModelo();
  const atual = await estadoDoModelo();
  if (atual.situacao !== 'nao_existe') return atual;
  try {
    const waba = await wabaDoRemetente();
    const resp = await fetch(`https://graph.facebook.com/${versaoApi()}/${waba}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nome,
        language: 'pt_BR',
        category: 'UTILITY',
        components: [
          {
            type: 'BODY',
            text: TEXTO_MODELO,
            example: {
              body_text: [
                [
                  'sábado 03/10',
                  'Prainha Bar R$ 9.469 (44 contas) · Tabuará R$ 5.046 (11 contas) · Prainha Mar R$ 19.206 (78 contas) · Total R$ 33.722',
                ],
              ],
            },
          },
          { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: BOTAO_MODELO }] },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await resp.json().catch(() => null)) as
      | { status?: string; error?: { message?: string; error_user_msg?: string } }
      | null;
    if (!resp.ok) {
      return {
        nome,
        situacao: 'indisponivel',
        detalhe: json?.error?.error_user_msg ?? json?.error?.message ?? `HTTP ${resp.status}`,
      };
    }
    const st = (json?.status ?? '').toUpperCase();
    if (st === 'APPROVED') return { nome, situacao: 'aprovado', detalhe: null };
    if (st === 'REJECTED') return { nome, situacao: 'recusado', detalhe: st };
    return { nome, situacao: 'em_analise', detalhe: null };
  } catch (e) {
    return { nome, situacao: 'indisponivel', detalhe: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Telefones
// ---------------------------------------------------------------------------

/** "(79) 99999-0000" → "5579999990000". Devolve null se não parece celular/fixo BR. */
export function normalizarTelefone(bruto: string): string | null {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith('55') || (d.length !== 12 && d.length !== 13)) return null;
  return d;
}

/** DDD + 8 últimos dígitos — a Meta manda o `from` de vários DDDs sem o 9. */
export function chaveTelefone(fone: string): string {
  const d = String(fone ?? '').replace(/\D/g, '');
  const semPais = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  return `${semPais.slice(0, 2)}${semPais.slice(-8)}`;
}

// ---------------------------------------------------------------------------
// Configuração (quem recebe)
// ---------------------------------------------------------------------------

export interface ConfigRelatorio {
  organizacaoId: string;
  ativo: boolean;
  telefones: string[];
}

export async function lerConfig(organizacaoId: string): Promise<ConfigRelatorio> {
  const [row] = await db
    .select({ ativo: schema.relatorioDiarioConfig.ativo, telefones: schema.relatorioDiarioConfig.telefones })
    .from(schema.relatorioDiarioConfig)
    .where(eq(schema.relatorioDiarioConfig.organizacaoId, organizacaoId))
    .limit(1);
  return { organizacaoId, ativo: row?.ativo ?? true, telefones: row?.telefones ?? [] };
}

export async function salvarConfig(
  organizacaoId: string,
  dados: { ativo: boolean; telefones: string[] },
  usuarioId: string | null,
): Promise<ConfigRelatorio> {
  const telefones = [...new Set(dados.telefones)].slice(0, 10);
  await db
    .insert(schema.relatorioDiarioConfig)
    .values({ organizacaoId, ativo: dados.ativo, telefones, atualizadoPor: usuarioId })
    .onConflictDoUpdate({
      target: schema.relatorioDiarioConfig.organizacaoId,
      set: { ativo: dados.ativo, telefones, atualizadoPor: usuarioId, atualizadoEm: new Date() },
    });
  return { organizacaoId, ativo: dados.ativo, telefones };
}

/** Organizações em que o usuário é DONO (só o dono mexe em quem recebe). */
export async function organizacoesDoDono(userId: string): Promise<Array<{ id: string; nome: string }>> {
  return (await db.execute(sql`
    SELECT DISTINCT o.id, o.nome
      FROM usuario_filial uf
      JOIN filial f ON f.id = uf.filial_id
      JOIN organizacao o ON o.id = f.organizacao_id
     WHERE uf.usuario_id = ${userId}::uuid AND uf.role = 'DONO'
     ORDER BY o.nome
  `)) as unknown as Array<{ id: string; nome: string }>;
}

/** De quem é esse número? (destinatário configurado em alguma organização) */
async function destinatarioPorTelefone(from: string): Promise<{ organizacaoId: string; telefone: string } | null> {
  const chave = chaveTelefone(from);
  if (chave.length < 10) return null;
  const configs = await db
    .select({
      organizacaoId: schema.relatorioDiarioConfig.organizacaoId,
      telefones: schema.relatorioDiarioConfig.telefones,
    })
    .from(schema.relatorioDiarioConfig);
  for (const c of configs) {
    const telefone = (c.telefones ?? []).find((t) => chaveTelefone(t) === chave);
    if (telefone) return { organizacaoId: c.organizacaoId, telefone };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

async function registrar(linha: {
  organizacaoId: string;
  dia: string;
  telefone: string;
  canal: 'modelo' | 'texto' | 'toque';
  origem: OrigemEnvio;
  ok: boolean;
  erro?: string | null;
  waMessageId?: string | null;
  phoneNumberId?: string | null;
}): Promise<void> {
  await db.insert(schema.relatorioDiarioEnvio).values({
    organizacaoId: linha.organizacaoId,
    dia: linha.dia,
    telefone: linha.telefone,
    canal: linha.canal,
    origem: linha.origem,
    ok: linha.ok,
    erro: linha.erro ? linha.erro.slice(0, 500) : null,
    waMessageId: linha.waMessageId ?? null,
    phoneNumberId: linha.phoneNumberId ?? null,
  });
}

/** Número da casa por onde o destinatário falou com a gente nas últimas 24 h (ou null). */
async function janelaAberta(organizacaoId: string, telefone: string): Promise<string | null> {
  const [toque] = await db
    .select({ phoneNumberId: schema.relatorioDiarioEnvio.phoneNumberId })
    .from(schema.relatorioDiarioEnvio)
    .where(
      and(
        eq(schema.relatorioDiarioEnvio.organizacaoId, organizacaoId),
        eq(schema.relatorioDiarioEnvio.telefone, telefone),
        eq(schema.relatorioDiarioEnvio.canal, 'toque'),
        gte(schema.relatorioDiarioEnvio.criadoEm, new Date(Date.now() - JANELA_MS)),
      ),
    )
    .orderBy(desc(schema.relatorioDiarioEnvio.criadoEm))
    .limit(1);
  return toque?.phoneNumberId ?? null;
}

export interface EnvioRegistrado {
  dia: string;
  telefone: string;
  canal: string;
  origem: string;
  ok: boolean;
  erro: string | null;
  quando: string;
}

export async function ultimosEnvios(organizacaoId: string, limite = 12): Promise<EnvioRegistrado[]> {
  return (await db.execute(sql`
    SELECT dia::text AS dia, telefone, canal, origem, ok, erro,
           to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS quando
      FROM relatorio_diario_envio
     WHERE organizacao_id = ${organizacaoId}::uuid
     ORDER BY criado_em DESC
     LIMIT ${limite}
  `)) as unknown as EnvioRegistrado[];
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

/** Variável de modelo da Meta: sem quebra de linha, sem tab, sem 4+ espaços. */
const limpa = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** Modelo `relatorio_diario`: {{1}} = dia, {{2}} = resumo de uma linha, botão "Ver resumo". */
async function enviarModelo(
  para: string,
  dia: string,
  resumo: string,
): Promise<{ waMessageId: string | null; erro?: string; phoneNumberId: string }> {
  const phoneNumberId = phoneIdPadrao();
  if (!token() || !phoneNumberId) {
    return { waMessageId: null, erro: 'WhatsApp não configurado (token / phone id)', phoneNumberId };
  }
  try {
    const resp = await fetch(
      `https://graph.facebook.com/${versaoApi()}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: para,
          type: 'template',
          template: {
            name: nomeModelo(),
            language: { code: 'pt_BR' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: limpa(rotuloDia(dia), 60) },
                  { type: 'text', text: limpa(resumo, 600) },
                ],
              },
              {
                type: 'button',
                sub_type: 'quick_reply',
                index: '0',
                parameters: [{ type: 'payload', payload: `relatorio:${dia}` }],
              },
            ],
          },
        }),
      },
    );
    const json = (await resp.json().catch(() => null)) as
      | { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } }
      | null;
    if (!resp.ok) {
      const msg = json?.error?.message ?? 'erro desconhecido';
      // 132001 = o modelo ainda não existe/não foi aprovado nessa conta.
      const dica = json?.error?.code === 132001 ? ` (modelo "${nomeModelo()}" ainda não aprovado na Meta)` : '';
      return { waMessageId: null, erro: `${resp.status}: ${msg}${dica}`, phoneNumberId };
    }
    return { waMessageId: json?.messages?.[0]?.id ?? null, phoneNumberId };
  } catch (e) {
    return { waMessageId: null, erro: e instanceof Error ? e.message : String(e), phoneNumberId };
  }
}

/** Manda o relatório inteiro em texto por um número da casa. true = a Meta aceitou tudo. */
async function enviarTextoCompleto(
  alvo: { organizacaoId: string; telefone: string; para: string; phoneNumberId: string },
  dia: string,
  origem: OrigemEnvio,
  casas: RelatorioCasa[],
): Promise<boolean> {
  let tudoOk = true;
  for (const corpo of textoRelatorio(casas, dia, linkRelatorio(dia))) {
    const r = await enviarTexto(alvo.phoneNumberId, alvo.para, corpo);
    const ok = !!r.waMessageId;
    await registrar({
      organizacaoId: alvo.organizacaoId,
      dia,
      telefone: alvo.telefone,
      canal: 'texto',
      origem,
      ok,
      erro: r.erro ?? null,
      waMessageId: r.waMessageId,
      phoneNumberId: alvo.phoneNumberId,
    });
    if (!ok) {
      tudoOk = false;
      break;
    }
  }
  return tudoOk;
}

export interface ResultadoEnvio {
  telefone: string;
  canal: 'texto' | 'modelo' | 'nenhum';
  ok: boolean;
  erro?: string;
  pulado?: boolean;
}

/**
 * Manda o relatório do dia pra todos os destinatários da organização.
 * `cron` não repete o que já saiu naquele dia; `manual` manda de novo.
 */
export async function enviarRelatorioDiario(opts: {
  organizacaoId: string;
  dia?: string;
  origem: 'cron' | 'manual';
  /** só esses (têm que estar na lista); vazio = todos */
  telefones?: string[];
}): Promise<{ dia: string; resultados: ResultadoEnvio[] }> {
  const dia = opts.dia ?? ultimoDiaFechado();
  const cfg = await lerConfig(opts.organizacaoId);
  const alvos = opts.telefones?.length ? cfg.telefones.filter((t) => opts.telefones?.includes(t)) : cfg.telefones;
  if (!alvos.length) return { dia, resultados: [] };

  // No cron, quem já recebeu o relatório desse dia não recebe de novo.
  let jaRecebeu = new Set<string>();
  if (opts.origem === 'cron') {
    const feitos = await db
      .select({ telefone: schema.relatorioDiarioEnvio.telefone })
      .from(schema.relatorioDiarioEnvio)
      .where(
        and(
          eq(schema.relatorioDiarioEnvio.organizacaoId, opts.organizacaoId),
          eq(schema.relatorioDiarioEnvio.dia, dia),
          eq(schema.relatorioDiarioEnvio.origem, 'cron'),
          eq(schema.relatorioDiarioEnvio.ok, true),
          inArray(schema.relatorioDiarioEnvio.canal, ['texto', 'modelo']),
        ),
      );
    jaRecebeu = new Set(feitos.map((f) => f.telefone));
  }
  const pendentes = alvos.filter((t) => !jaRecebeu.has(t));
  const resultados: ResultadoEnvio[] = alvos
    .filter((t) => jaRecebeu.has(t))
    .map((t) => ({ telefone: t, canal: 'nenhum' as const, ok: true, pulado: true }));
  if (!pendentes.length) return { dia, resultados };

  const casas = await montarRelatorioOrganizacao(opts.organizacaoId, dia);
  const resumo = resumoUmaLinha(casas);

  for (const telefone of pendentes) {
    const numeroDaJanela = await janelaAberta(opts.organizacaoId, telefone);
    if (numeroDaJanela) {
      const ok = await enviarTextoCompleto(
        { organizacaoId: opts.organizacaoId, telefone, para: telefone, phoneNumberId: numeroDaJanela },
        dia,
        opts.origem,
        casas,
      );
      if (ok) {
        resultados.push({ telefone, canal: 'texto', ok: true });
        continue;
      }
      // texto recusado na hora → cai no modelo
    }
    const m = await enviarModelo(telefone, dia, resumo);
    await registrar({
      organizacaoId: opts.organizacaoId,
      dia,
      telefone,
      canal: 'modelo',
      origem: opts.origem,
      ok: !!m.waMessageId,
      erro: m.erro ?? null,
      waMessageId: m.waMessageId,
      phoneNumberId: m.phoneNumberId || null,
    });
    resultados.push({ telefone, canal: 'modelo', ok: !!m.waMessageId, erro: m.erro });
  }
  return { dia, resultados };
}

/** Roda pra todas as organizações com o envio ligado (cron das 07:00). */
export async function enviarRelatoriosDoDia(): Promise<Array<{ organizacaoId: string; dia: string; resultados: ResultadoEnvio[] }>> {
  const configs = await db
    .select({
      organizacaoId: schema.relatorioDiarioConfig.organizacaoId,
      telefones: schema.relatorioDiarioConfig.telefones,
    })
    .from(schema.relatorioDiarioConfig)
    .where(eq(schema.relatorioDiarioConfig.ativo, true));
  const saida: Array<{ organizacaoId: string; dia: string; resultados: ResultadoEnvio[] }> = [];
  for (const c of configs) {
    if (!c.telefones?.length) continue;
    const r = await enviarRelatorioDiario({ organizacaoId: c.organizacaoId, origem: 'cron' });
    saida.push({ organizacaoId: c.organizacaoId, ...r });
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Webhook: o destinatário falou com a gente
// ---------------------------------------------------------------------------

/** "relatório", "relatório hoje", "relatório ontem", "relatório 02/10" → dia pedido (ou null se não é pedido). */
export function diaPedidoNoTexto(texto: string, agora: Date = new Date()): string | null {
  const t = texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ');
  const m = /^relatorio(?: (?:de |do dia |dia )?(hoje|ontem|\d{1,2}\/\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const hojeOperacional = dateToBrYmd(new Date(agora.getTime() - 5 * 3600 * 1000));
  if (!m[1] || m[1] === 'ontem') return somaDias(hojeOperacional, -1);
  if (m[1] === 'hoje') return hojeOperacional;
  const [d, mes] = m[1].split('/').map((x) => Number(x));
  if (!d || !mes || d > 31 || mes > 12) return somaDias(hojeOperacional, -1);
  const ano = Number(hojeOperacional.slice(0, 4));
  const monta = (a: number) => `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return monta(ano) > hojeOperacional ? monta(ano - 1) : monta(ano);
}

export interface PedidoRelatorio {
  organizacaoId: string;
  telefone: string;
  para: string;
  phoneNumberId: string;
  dia: string;
  origem: 'toque' | 'pedido';
  /** a Meta reentregou a mesma mensagem: já respondemos, não manda de novo */
  repetida?: boolean;
}

/**
 * Chamado pelo webhook em toda mensagem: se é um destinatário do relatório
 * tocando no botão "Ver resumo" ou escrevendo "relatório", registra o toque
 * (abre a janela de 24 h) e devolve o pedido pra responder. Qualquer outra
 * mensagem devolve null e segue o fluxo normal do webhook.
 */
export async function reconhecerPedidoRelatorio(msg: {
  id?: string;
  from?: string;
  payload?: string;
  textoBotao?: string;
  texto?: string;
  phoneNumberId?: string;
}): Promise<PedidoRelatorio | null> {
  if (!msg.from || !msg.phoneNumberId) return null;

  let dia: string | null = null;
  let origem: 'toque' | 'pedido' = 'toque';
  if (msg.payload?.startsWith('relatorio:')) {
    const d = msg.payload.slice('relatorio:'.length);
    dia = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ultimoDiaFechado();
  } else if (/^ver resumo$/i.test((msg.payload || msg.textoBotao || '').trim())) {
    // botão sem payload próprio: a Meta manda o texto do botão no lugar
    dia = ultimoDiaFechado();
  } else if (!msg.payload && msg.texto) {
    dia = diaPedidoNoTexto(msg.texto);
    origem = 'pedido';
  }
  if (!dia) return null;

  const dest = await destinatarioPorTelefone(msg.from);
  if (!dest) return null;

  // A Meta reentrega webhook: a mesma mensagem não gera dois relatórios.
  if (msg.id) {
    const [repetida] = await db
      .select({ id: schema.relatorioDiarioEnvio.id })
      .from(schema.relatorioDiarioEnvio)
      .where(and(eq(schema.relatorioDiarioEnvio.waMessageId, msg.id), eq(schema.relatorioDiarioEnvio.canal, 'toque')))
      .limit(1);
    if (repetida) return { ...dest, para: msg.from, phoneNumberId: msg.phoneNumberId, dia, origem, repetida: true };
  }
  await registrar({
    organizacaoId: dest.organizacaoId,
    dia,
    telefone: dest.telefone,
    canal: 'toque',
    origem,
    ok: true,
    waMessageId: msg.id ?? null,
    phoneNumberId: msg.phoneNumberId,
  });
  return { ...dest, para: msg.from, phoneNumberId: msg.phoneNumberId, dia, origem };
}

/** Responde o pedido com o relatório inteiro (roda no after() do webhook). */
export async function responderPedidoRelatorio(p: PedidoRelatorio): Promise<void> {
  if (p.repetida) return;
  try {
    const casas = await montarRelatorioOrganizacao(p.organizacaoId, p.dia);
    await enviarTextoCompleto(p, p.dia, p.origem, casas);
  } catch (e) {
    await registrar({
      organizacaoId: p.organizacaoId,
      dia: p.dia,
      telefone: p.telefone,
      canal: 'texto',
      origem: p.origem,
      ok: false,
      erro: e instanceof Error ? e.message : String(e),
      phoneNumberId: p.phoneNumberId,
    }).catch(() => {});
  }
}

/**
 * Status "failed" de uma mensagem nossa (webhook). Se era o texto do envio
 * automático (janela fechada sem a gente saber), manda o modelo no lugar.
 */
export async function registrarFalhaRelatorio(waMessageId: string, erro: string | null): Promise<void> {
  const [linha] = await db
    .select()
    .from(schema.relatorioDiarioEnvio)
    .where(and(eq(schema.relatorioDiarioEnvio.waMessageId, waMessageId), inArray(schema.relatorioDiarioEnvio.canal, ['texto', 'modelo'])))
    .limit(1);
  if (!linha || !linha.ok) return;
  await db
    .update(schema.relatorioDiarioEnvio)
    .set({ ok: false, erro: (erro ?? 'falha na entrega').slice(0, 500) })
    .where(eq(schema.relatorioDiarioEnvio.id, linha.id));
  if (linha.canal !== 'texto' || (linha.origem !== 'cron' && linha.origem !== 'manual')) return;

  const [jaFoiModelo] = await db
    .select({ id: schema.relatorioDiarioEnvio.id })
    .from(schema.relatorioDiarioEnvio)
    .where(
      and(
        eq(schema.relatorioDiarioEnvio.organizacaoId, linha.organizacaoId),
        eq(schema.relatorioDiarioEnvio.dia, linha.dia),
        eq(schema.relatorioDiarioEnvio.telefone, linha.telefone),
        eq(schema.relatorioDiarioEnvio.canal, 'modelo'),
        gte(schema.relatorioDiarioEnvio.criadoEm, linha.criadoEm),
      ),
    )
    .limit(1);
  if (jaFoiModelo) return;

  const casas = await montarRelatorioOrganizacao(linha.organizacaoId, linha.dia);
  const m = await enviarModelo(linha.telefone, linha.dia, resumoUmaLinha(casas));
  await registrar({
    organizacaoId: linha.organizacaoId,
    dia: linha.dia,
    telefone: linha.telefone,
    canal: 'modelo',
    origem: linha.origem as OrigemEnvio,
    ok: !!m.waMessageId,
    erro: m.erro ?? null,
    waMessageId: m.waMessageId,
    phoneNumberId: m.phoneNumberId || null,
  });
}
