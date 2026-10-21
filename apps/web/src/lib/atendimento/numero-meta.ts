// Estado e REGISTRO de um número na Cloud API da Meta.
//
// Por que existe (11/10): o número da Tabuará (79 3512-0567) ficou mais de um
// mês em "Pendente" no Gerenciador do WhatsApp. Adicionar o número e confirmar
// o código NÃO o registra na API: falta um POST /<id>/register com um PIN de 6
// dígitos, e esse passo não tem botão nem no Gerenciador nem no painel do app
// da Meta. O token permanente só existe em produção, então o passo mora aqui e
// quem aperta é o dono, em /atendimento/config.

function token(): string {
  return process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META || '';
}

function versao(): string {
  return process.env.WHATSAPP_API_VERSION || 'v21.0';
}

export interface EstadoNumeroMeta {
  numero: string | null;
  nome: string | null;
  /** CONNECTED, PENDING, FLAGGED, RESTRICTED, BANNED… */
  status: string | null;
  /** CLOUD_API depois de registrado; NOT_APPLICABLE antes. */
  plataforma: string | null;
  /** VERIFIED / NOT_VERIFIED / EXPIRED — o código por SMS ou ligação. */
  codigo: string | null;
  /** APPROVED, PENDING_REVIEW, DECLINED, NON_EXISTS… */
  nomeStatus: string | null;
  /** GREEN / YELLOW / RED / UNKNOWN */
  qualidade: string | null;
  /** TIER_250, TIER_2K… */
  limite: string | null;
  pinLigado: boolean | null;
  /** AVAILABLE / LIMITED / BLOCKED */
  podeEnviar: string | null;
  avisos: string[];
  erros: Array<{ codigo: number | null; descricao: string; solucao: string }>;
  registrado: boolean;
  erroLeitura?: string;
}

interface SaudeMeta {
  can_send_message?: string;
  entities?: Array<{
    entity_type?: string;
    errors?: Array<{ error_code?: number; error_description?: string; possible_solution?: string }>;
    additional_info?: string[];
  }>;
}

interface NumeroGraph {
  display_phone_number?: string;
  verified_name?: string;
  status?: string;
  platform_type?: string;
  code_verification_status?: string;
  name_status?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
  is_pin_enabled?: boolean;
  health_status?: SaudeMeta;
  error?: { message?: string };
}

const CAMPOS =
  'display_phone_number,verified_name,status,platform_type,code_verification_status,quality_rating,messaging_limit_tier,is_pin_enabled,health_status';

async function lerGraph(phoneNumberId: string, campos: string): Promise<NumeroGraph | { erro: string }> {
  try {
    const r = await fetch(`https://graph.facebook.com/${versao()}/${phoneNumberId}?fields=${campos}`, {
      headers: { Authorization: `Bearer ${token()}` },
      cache: 'no-store',
    });
    const j = (await r.json().catch(() => null)) as NumeroGraph | null;
    if (!r.ok || !j) return { erro: j?.error?.message ?? `HTTP ${r.status}` };
    return j;
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) };
  }
}

const VAZIO: EstadoNumeroMeta = {
  numero: null,
  nome: null,
  status: null,
  plataforma: null,
  codigo: null,
  nomeStatus: null,
  qualidade: null,
  limite: null,
  pinLigado: null,
  podeEnviar: null,
  avisos: [],
  erros: [],
  registrado: false,
};

export async function lerEstadoNumeroMeta(phoneNumberId: string): Promise<EstadoNumeroMeta> {
  if (!token()) return { ...VAZIO, erroLeitura: 'WHATSAPP_TOKEN/META ausente' };
  // name_status é beta na Meta: vai junto e, se a conta não enxergar, a leitura
  // se repete sem ele em vez de falhar inteira.
  let g = await lerGraph(phoneNumberId, `${CAMPOS},name_status`);
  if ('erro' in g) g = await lerGraph(phoneNumberId, CAMPOS);
  if ('erro' in g) return { ...VAZIO, erroLeitura: g.erro };

  const avisos = new Set<string>();
  const erros: EstadoNumeroMeta['erros'] = [];
  for (const e of g.health_status?.entities ?? []) {
    for (const a of e.additional_info ?? []) avisos.add(a);
    if (e.entity_type !== 'PHONE_NUMBER') continue;
    for (const er of e.errors ?? []) {
      // 138xxx é da API de LIGAÇÕES (SIP), que a casa não usa — só faz barulho.
      if (er.error_code && er.error_code >= 138000 && er.error_code < 139000) continue;
      erros.push({
        codigo: er.error_code ?? null,
        descricao: er.error_description ?? '',
        solucao: er.possible_solution ?? '',
      });
    }
  }

  return {
    numero: g.display_phone_number ?? null,
    nome: g.verified_name ?? null,
    status: g.status ?? null,
    plataforma: g.platform_type ?? null,
    codigo: g.code_verification_status ?? null,
    nomeStatus: g.name_status ?? null,
    qualidade: g.quality_rating ?? null,
    limite: g.messaging_limit_tier ?? null,
    pinLigado: typeof g.is_pin_enabled === 'boolean' ? g.is_pin_enabled : null,
    podeEnviar: g.health_status?.can_send_message ?? null,
    avisos: [...avisos],
    erros,
    registrado: g.platform_type === 'CLOUD_API',
  };
}

// O que cada recusa da Meta quer dizer, em português. A Meta só deixa 10
// tentativas de registro por número a cada 72 h (133016) — por isso a rota não
// tenta de novo sozinha.
const RECUSAS: Record<number, string> = {
  133005: 'PIN incorreto: este número já tem um PIN de verificação em duas etapas e o digitado não é ele.',
  133006: 'A Meta pede a confirmação do código de novo antes de registrar (Gerenciador do WhatsApp → Números de telefone).',
  133008: 'Muitas tentativas de PIN errado. A Meta bloqueou novas tentativas por um tempo.',
  133009: 'PIN digitado rápido demais várias vezes. Espere alguns minutos.',
  133015: 'O número foi apagado há pouco na Meta. Espere 5 minutos e tente de novo.',
  133016: 'Limite de tentativas de registro atingido (10 em 72 horas). Só dá pra tentar de novo depois desse prazo.',
};

export async function registrarNumeroMeta(
  phoneNumberId: string,
  pin: string,
): Promise<{ ok: boolean; erro?: string; codigo?: number }> {
  if (!token()) return { ok: false, erro: 'WHATSAPP_TOKEN/META ausente' };
  try {
    const r = await fetch(`https://graph.facebook.com/${versao()}/${phoneNumberId}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });
    const j = (await r.json().catch(() => null)) as {
      success?: boolean;
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    } | null;
    if (r.ok && j?.success) return { ok: true };
    const codigo = j?.error?.code;
    const bruto = [j?.error?.message, j?.error?.error_data?.details].filter(Boolean).join(' — ') || `HTTP ${r.status}`;
    return {
      ok: false,
      codigo,
      erro: codigo && RECUSAS[codigo] ? `${RECUSAS[codigo]} (Meta ${codigo}: ${bruto})` : `Meta recusou: ${bruto}`,
    };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

// ── NÚMERO NOVO NA CONTA (20/10, Prainha Mar) ────────────────────────────────
// Adicionar o número na conta do WhatsApp (WABA), pedir o código por SMS ou
// ligação e confirmar o código — os passos que antes só existiam no Gerenciador
// do WhatsApp. Depois disso entra o registro com PIN de sempre (acima).

type RespostaGraph = Record<string, unknown> & {
  error?: { message?: string; code?: number; error_user_msg?: string; error_data?: { details?: string } };
};

async function chamarGraph(
  caminho: string,
  metodo: 'GET' | 'POST',
  corpo?: Record<string, unknown>,
): Promise<{ ok: true; j: RespostaGraph } | { ok: false; erro: string; codigo?: number }> {
  if (!token()) return { ok: false, erro: 'WHATSAPP_TOKEN/META ausente' };
  try {
    const r = await fetch(`https://graph.facebook.com/${versao()}/${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
    const j = ((await r.json().catch(() => null)) ?? {}) as RespostaGraph;
    if (r.ok && !j.error) return { ok: true, j };
    const e = j.error;
    const msg = [e?.error_user_msg || e?.message, e?.error_data?.details].filter(Boolean).join(' — ');
    return { ok: false, erro: msg || `HTTP ${r.status}`, codigo: e?.code };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/** A conta (WABA) dos números já ligados — sai da saúde do número. */
export async function wabaDosNumeros(phoneNumberIds: string[]): Promise<string | null> {
  for (const id of phoneNumberIds) {
    const r = await chamarGraph(`${id}?fields=health_status`, 'GET');
    if (!r.ok) continue;
    const saude = r.j.health_status as SaudeMeta | undefined;
    const waba = (saude?.entities ?? []).find((e) => e.entity_type === 'WABA') as { id?: string } | undefined;
    if (waba?.id) return waba.id;
  }
  return null;
}

/** Números que já estão na conta: [{ id, numero (só dígitos), nome }]. */
export async function numerosDaWaba(waba: string): Promise<Array<{ id: string; digitos: string; nome: string }>> {
  const r = await chamarGraph(`${waba}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`, 'GET');
  if (!r.ok) return [];
  const data = (r.j.data as Array<{ id?: string; display_phone_number?: string; verified_name?: string }>) ?? [];
  return data
    .filter((n) => n.id)
    .map((n) => ({ id: n.id!, digitos: (n.display_phone_number ?? '').replace(/\D/g, ''), nome: n.verified_name ?? '' }));
}

/** POST /<waba>/phone_numbers — devolve o phone_number_id novo. */
export async function adicionarNumeroNaWaba(
  waba: string,
  ddi: string,
  numero: string,
  nomeExibicao: string,
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const r = await chamarGraph(`${waba}/phone_numbers`, 'POST', {
    cc: ddi,
    phone_number: numero,
    verified_name: nomeExibicao,
  });
  if (!r.ok) {
    // O usuário de sistema do token não pode criar número na conta (20/10).
    if (r.codigo === 200) {
      return {
        ok: false,
        erro:
          'A Meta não deixa o app criar número na conta. Adicione pelo Gerenciador do WhatsApp → Números de telefone → "Adicionar telefone" (com o código por SMS) e depois clique aqui de novo: o app liga o número a esta casa e mostra o PIN.',
      };
    }
    return { ok: false, erro: `Meta recusou: ${r.erro}${r.codigo ? ` (${r.codigo})` : ''}` };
  }
  const id =typeof r.j.id === 'string' ? r.j.id : '';
  return id ? { ok: true, id } : { ok: false, erro: 'A Meta não devolveu o id do número.' };
}

const RECUSAS_CODIGO: Record<number, string> = {
  136024: 'Código errado ou vencido. Peça um novo.',
  136025: 'Código errado. Confira o SMS e digite de novo.',
  133010: 'Este número ainda não foi adicionado na conta do WhatsApp.',
};

/** POST /<id>/request_code — manda o código de 6 dígitos por SMS ou ligação. */
export async function pedirCodigoMeta(
  phoneNumberId: string,
  metodo: 'SMS' | 'VOICE',
): Promise<{ ok: boolean; erro?: string }> {
  const r = await chamarGraph(`${phoneNumberId}/request_code`, 'POST', { code_method: metodo, language: 'pt_BR' });
  if (r.ok) return { ok: true };
  const dica = r.codigo ? RECUSAS_CODIGO[r.codigo] : undefined;
  return { ok: false, erro: dica ? `${dica} (Meta ${r.codigo}: ${r.erro})` : `Meta recusou: ${r.erro}` };
}

/** POST /<id>/verify_code — confirma o código que chegou no telefone. */
export async function confirmarCodigoMeta(phoneNumberId: string, codigo: string): Promise<{ ok: boolean; erro?: string }> {
  const r = await chamarGraph(`${phoneNumberId}/verify_code`, 'POST', { code: codigo });
  if (r.ok) return { ok: true };
  const dica = r.codigo ? RECUSAS_CODIGO[r.codigo] : undefined;
  return { ok: false, erro: dica ? `${dica} (Meta ${r.codigo}: ${r.erro})` : `Meta recusou: ${r.erro}` };
}
