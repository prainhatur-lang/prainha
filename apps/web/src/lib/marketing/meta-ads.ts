// ANÚNCIOS DA META (Marketing API) — saldo da conta de anúncios, gasto,
// resultados por dia e por campanha, e impulsionar post do Instagram.
//
// A chave é de USUÁRIO DO SISTEMA do Gerenciador de Negócios (não vence), com
// `ads_read` (ver) e `ads_management` (impulsionar/pausar). A casa cola a chave
// em /marketing/anuncios e escolhe a conta de anúncios dela; fica cifrada em
// filial_credencial (lib/marketing/anuncios-ligacao.ts).
//
// Este arquivo só fala com a Meta (não toca no banco).

const GRAPH = 'https://graph.facebook.com';
const VERSAO = () => (process.env.META_ADS_API_VERSION ?? '').trim() || 'v23.0';
const ESPERA_MS = 20000;

export class ErroMeta extends Error {
  constructor(
    mensagem: string,
    readonly codigo: number | null = null,
  ) {
    super(mensagem);
    this.name = 'ErroMeta';
  }
}

type Json = Record<string, unknown>;

function erroDe(j: Json, status: number): ErroMeta {
  const e = (j.error ?? {}) as {
    message?: string;
    error_user_title?: string;
    error_user_msg?: string;
    code?: number;
  };
  const msg = e.error_user_msg || e.message || `a Meta respondeu ${status}`;
  const titulo = e.error_user_title && e.error_user_msg ? `${e.error_user_title}: ` : '';
  if (e.code === 190) return new ErroMeta(`Chave da Meta inválida ou revogada (${msg}). Gere outra e cole de novo.`, 190);
  if (e.code === 200 || e.code === 10)
    return new ErroMeta(`A chave não tem permissão pra isso (${msg}). Confira ads_read/ads_management no usuário do sistema.`, e.code);
  return new ErroMeta(`${titulo}${msg}`, e.code ?? null);
}

async function pedir(
  metodo: 'GET' | 'POST' | 'DELETE',
  caminho: string,
  token: string,
  params: Record<string, string | number | boolean | object | undefined> = {},
): Promise<Json> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    q.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  q.set('access_token', token);
  const base = `${GRAPH}/${VERSAO()}/${caminho.replace(/^\/+/, '')}`;
  let resp: Response;
  try {
    resp =
      metodo === 'GET'
        ? await fetch(`${base}?${q.toString()}`, { cache: 'no-store', signal: AbortSignal.timeout(ESPERA_MS) })
        : await fetch(base, {
            method: metodo,
            body: q,
            cache: 'no-store',
            signal: AbortSignal.timeout(ESPERA_MS),
          });
  } catch (e) {
    throw new ErroMeta(`Sem resposta da Meta (${e instanceof Error ? e.message : String(e)}).`);
  }
  const j = (await resp.json().catch(() => ({}))) as Json;
  if (!resp.ok || j.error) throw erroDe(j, resp.status);
  return j;
}

/** GET que segue a paginação (até `max` linhas). */
async function lista<T>(caminho: string, token: string, params: Record<string, string | number | object>, max = 500): Promise<T[]> {
  const out: T[] = [];
  let j = await pedir('GET', caminho, token, { limit: 100, ...params });
  for (;;) {
    out.push(...(((j.data as T[]) ?? []) as T[]));
    const prox = (j.paging as { next?: string } | undefined)?.next;
    if (!prox || out.length >= max) break;
    const r = await fetch(prox, { cache: 'no-store', signal: AbortSignal.timeout(ESPERA_MS) });
    j = (await r.json().catch(() => ({}))) as Json;
    if (!r.ok || j.error) throw erroDe(j, r.status);
  }
  return out.slice(0, max);
}

// ── chave e contas ─────────────────────────────────────────────────────────

export interface ContaAnuncio {
  id: string; // act_123
  nome: string;
  moeda: string;
  status: number;
  empresa: string | null;
}

export interface QuemEhChave {
  id: string;
  nome: string;
  permissoes: string[];
  contas: ContaAnuncio[];
}

/** Confere a chave colada: quem é, que permissões tem e que contas de anúncio enxerga. */
export async function conferirChave(token: string): Promise<QuemEhChave> {
  const me = await pedir('GET', 'me', token, { fields: 'id,name' });
  let permissoes: string[] = [];
  try {
    const p = await pedir('GET', 'me/permissions', token);
    permissoes = ((p.data as Array<{ permission: string; status: string }>) ?? [])
      .filter((x) => x.status === 'granted')
      .map((x) => x.permission);
  } catch {
    // alguns tipos de chave não respondem /permissions: segue sem a lista
  }
  const contas = await lista<{ id: string; name: string; currency: string; account_status: number; business?: { name?: string } }>(
    'me/adaccounts',
    token,
    { fields: 'id,name,currency,account_status,business{name}' },
    200,
  );
  return {
    id: String(me.id ?? ''),
    nome: String(me.name ?? ''),
    permissoes,
    contas: contas.map((c) => ({
      id: c.id,
      nome: c.name,
      moeda: c.currency,
      status: c.account_status,
      empresa: c.business?.name ?? null,
    })),
  };
}

export const STATUS_CONTA: Record<number, string> = {
  1: 'Ativa',
  2: 'Desativada',
  3: 'Pagamento pendente',
  7: 'Em análise de risco',
  8: 'Acerto pendente',
  9: 'Período de carência',
  100: 'Fechamento pendente',
  101: 'Fechada',
};

export interface ResumoConta {
  id: string;
  nome: string;
  moeda: string;
  status: number;
  fuso: string;
  /** centavos — o que já foi gasto na vida da conta */
  gastoTotalCent: number;
  /** centavos — conta pós-paga: o que está pra cobrar */
  aPagarCent: number;
  /** centavos — limite de gasto da conta (0 = sem limite) */
  limiteCent: number;
  prePaga: boolean;
  /** texto da Meta sobre a forma de pagamento (ex.: "Saldo disponível (R$ 120,00 BRL)") */
  formaPagamento: string | null;
  /** saldo pré-pago tirado do texto acima, em reais (null = a Meta não informou) */
  saldoDisponivel: number | null;
  motivoBloqueio: number | null;
}

/** Tira o valor de "Saldo disponível (R$ 1.234,56 BRL)" / "Available balance (R$1,234.56 BRL)". */
export function saldoDoTexto(t: string | null | undefined): number | null {
  if (!t || !/saldo|balance|fundos|cr[eé]dito/i.test(t)) return null;
  const m = t.match(/(-?[\d.,]+)\s*(?:BRL|\))/) ?? t.match(/R\$\s*(-?[\d.,]+)/);
  if (!m?.[1]) return null;
  let s = m[1];
  const ultVirg = s.lastIndexOf(',');
  const ultPonto = s.lastIndexOf('.');
  if (ultVirg > ultPonto) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function resumoConta(token: string, contaId: string): Promise<ResumoConta> {
  const base = 'id,name,currency,account_status,timezone_name,amount_spent,balance,spend_cap,is_prepay_account,disable_reason';
  let j: Json;
  try {
    j = await pedir('GET', contaId, token, { fields: `${base},funding_source_details` });
  } catch {
    // funding_source_details pede mais permissão em algumas contas
    j = await pedir('GET', contaId, token, { fields: base });
  }
  const fonte = (j.funding_source_details ?? null) as { display_string?: string } | null;
  const formaPagamento = fonte?.display_string ?? null;
  return {
    id: String(j.id ?? contaId),
    nome: String(j.name ?? ''),
    moeda: String(j.currency ?? 'BRL'),
    status: Number(j.account_status ?? 0),
    fuso: String(j.timezone_name ?? ''),
    gastoTotalCent: Number(j.amount_spent ?? 0) || 0,
    aPagarCent: Number(j.balance ?? 0) || 0,
    limiteCent: Number(j.spend_cap ?? 0) || 0,
    prePaga: Boolean(j.is_prepay_account),
    formaPagamento,
    saldoDisponivel: saldoDoTexto(formaPagamento),
    motivoBloqueio: j.disable_reason ? Number(j.disable_reason) : null,
  };
}

// ── números (insights) ─────────────────────────────────────────────────────

export interface Acao {
  tipo: string;
  valor: number;
}

export interface Numeros {
  gasto: number;
  impressoes: number;
  alcance: number;
  cliques: number;
  cliquesLink: number;
  acoes: Acao[];
}

interface LinhaInsight {
  date_start?: string;
  campaign_id?: string;
  campaign_name?: string;
  objective?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

const CAMPOS_NUMEROS = 'spend,impressions,reach,clicks,inline_link_clicks,actions';

function numeros(l: LinhaInsight): Numeros {
  return {
    gasto: Number(l.spend ?? 0) || 0,
    impressoes: Number(l.impressions ?? 0) || 0,
    alcance: Number(l.reach ?? 0) || 0,
    cliques: Number(l.clicks ?? 0) || 0,
    cliquesLink: Number(l.inline_link_clicks ?? 0) || 0,
    acoes: (l.actions ?? []).map((a) => ({ tipo: a.action_type, valor: Number(a.value) || 0 })),
  };
}

export const numerosVazios = (): Numeros => ({ gasto: 0, impressoes: 0, alcance: 0, cliques: 0, cliquesLink: 0, acoes: [] });

/** Total do período (alcance = pessoas únicas no período, não soma dos dias). */
export async function numerosPeriodo(token: string, contaId: string, de: string, ate: string): Promise<Numeros> {
  const r = await lista<LinhaInsight>(`${contaId}/insights`, token, {
    level: 'account',
    fields: CAMPOS_NUMEROS,
    time_range: { since: de, until: ate },
  });
  return r[0] ? numeros(r[0]) : numerosVazios();
}

/** Um ponto por dia (só os dias com entrega vêm da Meta). */
export async function numerosPorDia(
  token: string,
  contaId: string,
  de: string,
  ate: string,
): Promise<Array<{ dia: string } & Numeros>> {
  const r = await lista<LinhaInsight>(`${contaId}/insights`, token, {
    level: 'account',
    fields: CAMPOS_NUMEROS,
    time_range: { since: de, until: ate },
    time_increment: 1,
  });
  return r.map((l) => ({ dia: String(l.date_start ?? ''), ...numeros(l) }));
}

export interface Campanha {
  id: string;
  nome: string;
  objetivo: string;
  status: string;
  /** o que de fato está rodando (ACTIVE, PAUSED, CAMPAIGN_PAUSED, IN_PROCESS, WITH_ISSUES…) */
  statusEfetivo: string;
  /** reais por dia (soma dos conjuntos ativos quando o orçamento é no conjunto) */
  orcamentoDia: number | null;
  /** reais no total */
  orcamentoTotal: number | null;
  inicio: string | null;
  fim: string | null;
  numeros: Numeros;
}

/** Campanhas da conta com os números do período (as sem entrega ficam zeradas). */
export async function campanhas(token: string, contaId: string, de: string, ate: string): Promise<Campanha[]> {
  const [lc, li, la] = await Promise.all([
    lista<{
      id: string;
      name: string;
      objective?: string;
      status?: string;
      effective_status?: string;
      daily_budget?: string;
      lifetime_budget?: string;
      start_time?: string;
      stop_time?: string;
      updated_time?: string;
    }>(`${contaId}/campaigns`, token, {
      fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time,updated_time',
    }, 200),
    lista<LinhaInsight>(`${contaId}/insights`, token, {
      level: 'campaign',
      fields: `campaign_id,campaign_name,objective,${CAMPOS_NUMEROS}`,
      time_range: { since: de, until: ate },
    }),
    lista<{ campaign_id: string; daily_budget?: string; lifetime_budget?: string; end_time?: string; effective_status?: string }>(
      `${contaId}/adsets`,
      token,
      { fields: 'campaign_id,daily_budget,lifetime_budget,end_time,effective_status' },
      500,
    ).catch(() => []),
  ]);
  const ins = new Map(li.map((l) => [String(l.campaign_id), l]));
  const conj = new Map<string, { dia: number; total: number; fim: string | null }>();
  for (const a of la) {
    if (a.effective_status && !['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'IN_PROCESS', 'WITH_ISSUES'].includes(a.effective_status)) continue;
    const c = conj.get(a.campaign_id) ?? { dia: 0, total: 0, fim: null };
    c.dia += (Number(a.daily_budget ?? 0) || 0) / 100;
    c.total += (Number(a.lifetime_budget ?? 0) || 0) / 100;
    if (a.end_time && (!c.fim || a.end_time > c.fim)) c.fim = a.end_time;
    conj.set(a.campaign_id, c);
  }
  const out: Campanha[] = lc.map((c) => {
    const cj = conj.get(c.id);
    const dia = c.daily_budget ? Number(c.daily_budget) / 100 : cj?.dia || null;
    const total = c.lifetime_budget ? Number(c.lifetime_budget) / 100 : cj?.total || null;
    const l = ins.get(c.id);
    return {
      id: c.id,
      nome: c.name,
      objetivo: c.objective ?? l?.objective ?? '',
      status: c.status ?? '',
      statusEfetivo: c.effective_status ?? c.status ?? '',
      orcamentoDia: dia,
      orcamentoTotal: total,
      inicio: c.start_time ?? null,
      fim: c.stop_time ?? cj?.fim ?? null,
      numeros: l ? numeros(l) : numerosVazios(),
    };
  });
  // campanha com gasto no período que não veio na lista (apagada/arquivada)
  for (const [id, l] of ins) {
    if (out.some((c) => c.id === id)) continue;
    out.push({
      id,
      nome: l.campaign_name ?? id,
      objetivo: l.objective ?? '',
      status: 'ARCHIVED',
      statusEfetivo: 'ARCHIVED',
      orcamentoDia: null,
      orcamentoTotal: null,
      inicio: null,
      fim: null,
      numeros: numeros(l),
    });
  }
  // rodando primeiro, depois quem gastou mais
  const rodando = (c: Campanha) => (c.statusEfetivo === 'ACTIVE' ? 0 : 1);
  return out.sort((a, b) => rodando(a) - rodando(b) || b.numeros.gasto - a.numeros.gasto);
}

// ── o "resultado" de cada objetivo ─────────────────────────────────────────

export const NOME_ACAO: Record<string, string> = {
  'onsite_conversion.messaging_conversation_started_7d': 'Conversas iniciadas',
  'onsite_conversion.messaging_first_reply': 'Primeiras respostas',
  'onsite_conversion.total_messaging_connection': 'Contatos por mensagem',
  post_engagement: 'Engajamento com o post',
  page_engagement: 'Engajamento com a página',
  post_reaction: 'Reações',
  like: 'Curtidas na página',
  comment: 'Comentários',
  post: 'Compartilhamentos',
  'onsite_conversion.post_save': 'Salvos',
  link_click: 'Cliques no link',
  landing_page_view: 'Visitas à página do link',
  video_view: 'Visualizações de vídeo (3 s)',
  lead: 'Cadastros (leads)',
  'onsite_conversion.lead_grouped': 'Cadastros (leads)',
  purchase: 'Compras',
  'offsite_conversion.fb_pixel_purchase': 'Compras no site',
  'onsite_web_purchase': 'Compras no site',
  'omni_purchase': 'Compras',
  'onsite_conversion.flow_complete': 'Formulários concluídos',
  'instagram_profile_visit': 'Visitas ao perfil',
  'onsite_conversion.ig_profile_visit': 'Visitas ao perfil',
  follow: 'Novos seguidores',
};

export const NOME_OBJETIVO: Record<string, string> = {
  OUTCOME_AWARENESS: 'Reconhecimento',
  OUTCOME_ENGAGEMENT: 'Engajamento',
  OUTCOME_TRAFFIC: 'Tráfego',
  OUTCOME_LEADS: 'Cadastros',
  OUTCOME_SALES: 'Vendas',
  OUTCOME_APP_PROMOTION: 'App',
  POST_ENGAGEMENT: 'Engajamento (post)',
  MESSAGES: 'Mensagens',
  REACH: 'Alcance',
  BRAND_AWARENESS: 'Reconhecimento',
  LINK_CLICKS: 'Cliques',
  CONVERSIONS: 'Conversões',
  VIDEO_VIEWS: 'Vídeo',
  LEAD_GENERATION: 'Cadastros',
};

const valorAcao = (n: Numeros, tipo: string) => n.acoes.find((a) => a.tipo === tipo)?.valor ?? 0;

/** O resultado que a campanha comprou, pelo objetivo (igual o Gerenciador mostra). */
export function resultado(objetivo: string, n: Numeros): { nome: string; valor: number } {
  const conversa = valorAcao(n, 'onsite_conversion.messaging_conversation_started_7d');
  const tenta = (tipos: string[]) => {
    for (const t of tipos) {
      const v = valorAcao(n, t);
      if (v > 0) return { nome: NOME_ACAO[t] ?? t, valor: v };
    }
    return null;
  };
  const o = objetivo.toUpperCase();
  if (conversa > 0 && (o === 'OUTCOME_ENGAGEMENT' || o === 'MESSAGES' || o === 'OUTCOME_LEADS' || o === 'OUTCOME_SALES'))
    return { nome: NOME_ACAO['onsite_conversion.messaging_conversation_started_7d']!, valor: conversa };
  if (o === 'OUTCOME_AWARENESS' || o === 'REACH' || o === 'BRAND_AWARENESS') return { nome: 'Pessoas alcançadas', valor: n.alcance };
  if (o === 'OUTCOME_TRAFFIC' || o === 'LINK_CLICKS')
    return tenta(['instagram_profile_visit', 'onsite_conversion.ig_profile_visit', 'landing_page_view', 'link_click']) ?? {
      nome: 'Cliques no link',
      valor: n.cliquesLink,
    };
  if (o === 'OUTCOME_LEADS' || o === 'LEAD_GENERATION')
    return tenta(['lead', 'onsite_conversion.lead_grouped', 'onsite_conversion.flow_complete']) ?? { nome: 'Cadastros (leads)', valor: 0 };
  if (o === 'OUTCOME_SALES' || o === 'CONVERSIONS')
    return tenta(['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']) ?? { nome: 'Compras', valor: 0 };
  if (o === 'VIDEO_VIEWS') return { nome: NOME_ACAO.video_view!, valor: valorAcao(n, 'video_view') };
  if (conversa > 0) return { nome: NOME_ACAO['onsite_conversion.messaging_conversation_started_7d']!, valor: conversa };
  return tenta(['post_engagement', 'page_engagement', 'link_click']) ?? { nome: 'Engajamento com o post', valor: 0 };
}

// ── impulsionar post do Instagram ──────────────────────────────────────────

export interface ContaInstagramAnuncio {
  igId: string;
  usuario: string;
  paginaId: string | null;
  paginaNome: string | null;
}

/** Contas do Instagram que a conta de anúncios pode usar (com a Página do Facebook, se houver). */
export async function contasInstagramDaConta(token: string, contaId: string): Promise<ContaInstagramAnuncio[]> {
  const out = new Map<string, ContaInstagramAnuncio>();
  const juntar = (x: ContaInstagramAnuncio) => {
    const atual = out.get(x.igId);
    if (!atual || (!atual.paginaId && x.paginaId)) out.set(x.igId, { ...x, usuario: x.usuario || atual?.usuario || '' });
  };
  const paginas = async (caminho: string) => {
    const ps = await lista<{ id: string; name: string; instagram_business_account?: { id: string; username?: string } }>(
      caminho,
      token,
      { fields: 'id,name,instagram_business_account{id,username}' },
      100,
    ).catch(() => []);
    for (const p of ps)
      if (p.instagram_business_account?.id)
        juntar({
          igId: p.instagram_business_account.id,
          usuario: p.instagram_business_account.username ?? '',
          paginaId: p.id,
          paginaNome: p.name,
        });
  };
  await Promise.all([paginas('me/accounts'), paginas(`${contaId}/promote_pages`)]);
  const igs = await lista<{ id: string; username?: string }>(`${contaId}/instagram_accounts`, token, { fields: 'id,username' }, 50).catch(
    () => [],
  );
  for (const i of igs) juntar({ igId: i.id, usuario: i.username ?? '', paginaId: null, paginaNome: null });
  return [...out.values()];
}

export type ObjetivoImpulso = 'alcance' | 'engajamento';

export interface PedidoImpulso {
  contaId: string;
  igId: string;
  paginaId: string | null;
  midiaId: string;
  nome: string;
  objetivo: ObjetivoImpulso;
  /** reais por dia */
  porDia: number;
  dias: number;
  lat: number;
  lng: number;
  raioKm: number;
  idadeMin: number;
  idadeMax: number;
  soInstagram: boolean;
  pausado: boolean;
}

/** Cria campanha + conjunto + criativo (o próprio post) + anúncio. Falhou no meio = apaga a campanha. */
export async function impulsionarPost(token: string, p: PedidoImpulso): Promise<{ campanhaId: string; anuncioId: string }> {
  const status = p.pausado ? 'PAUSED' : 'ACTIVE';
  const objetivo = p.objetivo === 'alcance' ? 'OUTCOME_AWARENESS' : 'OUTCOME_ENGAGEMENT';
  const c = await pedir('POST', `${p.contaId}/campaigns`, token, {
    name: p.nome,
    objective: objetivo,
    status,
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
  });
  const campanhaId = String(c.id);
  try {
    const inicio = new Date(Date.now() + 5 * 60 * 1000);
    const fim = new Date(inicio.getTime() + p.dias * 24 * 3600 * 1000);
    const conj = await pedir('POST', `${p.contaId}/adsets`, token, {
      name: `${p.nome} · público`,
      campaign_id: campanhaId,
      daily_budget: Math.round(p.porDia * 100),
      billing_event: 'IMPRESSIONS',
      optimization_goal: p.objetivo === 'alcance' ? 'REACH' : 'POST_ENGAGEMENT',
      ...(p.objetivo === 'engajamento' ? { destination_type: 'ON_POST' } : {}),
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      start_time: inicio.toISOString(),
      end_time: fim.toISOString(),
      status,
      targeting: {
        geo_locations: {
          custom_locations: [{ latitude: p.lat, longitude: p.lng, radius: p.raioKm, distance_unit: 'kilometer' }],
          // quem mora E quem está de passagem (turista na praia)
          location_types: ['home', 'recent'],
        },
        age_min: p.idadeMin,
        age_max: p.idadeMax,
        publisher_platforms: p.soInstagram ? ['instagram'] : ['instagram', 'facebook'],
        targeting_automation: { advantage_audience: 0 },
      },
    });
    const cria = await pedir('POST', `${p.contaId}/adcreatives`, token, {
      name: `${p.nome} · post`,
      ...(p.paginaId ? { object_id: p.paginaId } : {}),
      instagram_user_id: p.igId,
      source_instagram_media_id: p.midiaId,
    });
    const ad = await pedir('POST', `${p.contaId}/ads`, token, {
      name: p.nome,
      adset_id: String(conj.id),
      creative: { creative_id: String(cria.id) },
      status,
    });
    return { campanhaId, anuncioId: String(ad.id) };
  } catch (e) {
    await pedir('DELETE', campanhaId, token).catch(() => null);
    throw e;
  }
}

/** Liga ou pausa uma campanha. */
export async function mudarStatusCampanha(token: string, campanhaId: string, ativa: boolean): Promise<void> {
  await pedir('POST', campanhaId, token, { status: ativa ? 'ACTIVE' : 'PAUSED' });
}

/** A campanha é desta conta de anúncios? (trava pra não mexer em campanha de outra casa) */
export async function campanhaDaConta(token: string, campanhaId: string, contaId: string): Promise<boolean> {
  const j = await pedir('GET', campanhaId, token, { fields: 'account_id' });
  return `act_${String(j.account_id ?? '')}` === contaId;
}
