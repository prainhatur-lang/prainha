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
