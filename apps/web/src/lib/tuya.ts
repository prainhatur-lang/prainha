/**
 * Cliente da Tuya Cloud API (openapi.tuya***.com) pro painel de energia —
 * lê estado/consumo dos disjuntores/tomadas Wi-Fi e manda comando de
 * liga/desliga.
 *
 * Auth: assinatura HMAC-SHA256 sobre client_id + access_token + timestamp +
 * (method\ncontent-sha256\nheaders\nurl), conforme a doc oficial da Tuya
 * (v1.0 signature). fetch() global do Node é suficiente aqui (sem mTLS).
 *
 * Uma conta só (TUYA_CLIENT_ID/TUYA_CLIENT_SECRET) cobre todas as filiais —
 * o mapeamento dispositivo -> filial vive na tabela tuya_dispositivo.
 */

import crypto from 'node:crypto';

const API_BASE = process.env.TUYA_API_BASE || 'https://openapi.tuyaus.com';
const CLIENT_ID = process.env.TUYA_CLIENT_ID;
const CLIENT_SECRET = process.env.TUYA_CLIENT_SECRET;

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function hmacSha256Upper(s: string, key: string): string {
  return crypto.createHmac('sha256', key).update(s, 'utf8').digest('hex').toUpperCase();
}

interface TuyaEnvelope<T> {
  success: boolean;
  result: T;
  code?: number;
  msg?: string;
}

async function tuyaFetch<T>(
  method: 'GET' | 'POST',
  pathWithQuery: string,
  body: unknown,
  accessToken: string | undefined,
): Promise<T> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('TUYA_CLIENT_ID/TUYA_CLIENT_SECRET não configurados');
  }
  const t = Date.now().toString();
  const bodyStr = body !== undefined ? JSON.stringify(body) : '';
  const contentSha256 = sha256Hex(bodyStr);
  const stringToSign = `${method}\n${contentSha256}\n\n${pathWithQuery}`;
  const signBase = CLIENT_ID + (accessToken ?? '') + t + stringToSign;
  const sign = hmacSha256Upper(signBase, CLIENT_SECRET);

  const headers: Record<string, string> = {
    client_id: CLIENT_ID,
    sign,
    t,
    sign_method: 'HMAC-SHA256',
    'Content-Type': 'application/json',
  };
  if (accessToken) headers.access_token = accessToken;

  const res = await fetch(`${API_BASE}${pathWithQuery}`, {
    method,
    headers,
    body: body !== undefined ? bodyStr : undefined,
  });
  const json = (await res.json()) as TuyaEnvelope<T>;
  if (!json.success) {
    throw new Error(`Tuya API erro (${json.code ?? res.status}): ${json.msg ?? 'sem detalhe'}`);
  }
  return json.result;
}

// Cache de token em memória — a conta é única pra todas as filiais.
let tokenCache: { token: string; expiraEm: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiraEm > Date.now()) return tokenCache.token;
  const result = await tuyaFetch<{ access_token: string; expire_time: number }>(
    'GET',
    '/v1.0/token?grant_type=1',
    undefined,
    undefined,
  );
  tokenCache = { token: result.access_token, expiraEm: Date.now() + (result.expire_time - 60) * 1000 };
  return tokenCache.token;
}

export interface TuyaStatusItem {
  code: string;
  value: unknown;
}

/** Estado bruto (todos os datapoints) do dispositivo na Tuya. */
export async function getDeviceStatus(tuyaDeviceId: string): Promise<TuyaStatusItem[]> {
  const token = await getAccessToken();
  return tuyaFetch<TuyaStatusItem[]>('GET', `/v1.0/devices/${tuyaDeviceId}/status`, undefined, token);
}

export interface TuyaDeviceInfo {
  id: string;
  name: string;
  online: boolean;
  product_name?: string;
}

export async function getDeviceInfo(tuyaDeviceId: string): Promise<TuyaDeviceInfo> {
  const token = await getAccessToken();
  return tuyaFetch<TuyaDeviceInfo>('GET', `/v1.0/devices/${tuyaDeviceId}`, undefined, token);
}

/** Manda um comando de datapoint (ex: { code: 'switch_1', value: true }). */
export async function sendCommands(
  tuyaDeviceId: string,
  commands: Array<{ code: string; value: boolean | number | string }>,
): Promise<void> {
  const token = await getAccessToken();
  await tuyaFetch<boolean>('POST', `/v1.0/devices/${tuyaDeviceId}/commands`, { commands }, token);
}

export async function ligarDesligar(tuyaDeviceId: string, codigoSwitch: string, ligar: boolean): Promise<void> {
  await sendCommands(tuyaDeviceId, [{ code: codigoSwitch, value: ligar }]);
}

export interface TuyaLeitura {
  ligado: boolean | null;
  potenciaW: number | null;
  tensaoV: number | null;
  correnteA: number | null;
  /** Consumo acumulado (contador de energia do dispositivo), em kWh. */
  energiaKwh: number | null;
  online: boolean | null;
  /** Sensor de porta/janela (doorcontact_state): true = aberta. */
  portaAberta: boolean | null;
  /** Sensor de presença (presence_state): true = presença detectada. */
  presencaDetectada: boolean | null;
  temperaturaC: number | null;
  umidadePct: number | null;
}

const LEITURA_VAZIA: Omit<TuyaLeitura, 'online'> = {
  ligado: null,
  potenciaW: null,
  tensaoV: null,
  correnteA: null,
  energiaKwh: null,
  portaAberta: null,
  presencaDetectada: null,
  temperaturaC: null,
  umidadePct: null,
};

/**
 * Interpreta os datapoints padrão da Tuya pra tomadas/disjuntores com
 * medição de energia (categoria "kg"/"cz"/"pc"). Datapoints não presentes
 * ficam null — nem todo dispositivo mede tensão/corrente/energia.
 */
export function interpretarStatus(items: TuyaStatusItem[], codigoSwitch: string): TuyaLeitura {
  const get = (code: string) => items.find((i) => i.code === code)?.value;
  const switchVal = get(codigoSwitch) ?? get('switch_1') ?? get('switch') ?? get('switch_led');
  const power = get('cur_power');
  const voltage = get('cur_voltage');
  const current = get('cur_current');
  const energy = get('add_ele');
  // Disjuntor DIN com medidor (pré-pago/fuga, ex: "Mar Disjuntor Freezer"):
  // não manda cur_*; manda phase_a em base64 e total_forward_energy (÷100).
  const fase = lerFaseA(get('phase_a'));
  const energiaTotal = get('total_forward_energy');
  return {
    ...LEITURA_VAZIA,
    ligado: typeof switchVal === 'boolean' ? switchVal : null,
    potenciaW: typeof power === 'number' ? power / 10 : (fase?.potenciaW ?? null),
    tensaoV: typeof voltage === 'number' ? voltage / 10 : (fase?.tensaoV ?? null),
    correnteA: typeof current === 'number' ? current / 1000 : (fase?.correnteA ?? null),
    energiaKwh:
      typeof energy === 'number' ? energy / 100 : typeof energiaTotal === 'number' ? energiaTotal / 100 : null,
    online: null,
  };
}

/**
 * phase_a dos medidores/disjuntores Tuya: base64 de 8 bytes —
 * tensão (2 bytes, ÷10 V), corrente (3 bytes, ÷1000 A), potência (3 bytes, ÷1000 kW).
 */
function lerFaseA(v: unknown): { tensaoV: number; correnteA: number; potenciaW: number } | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    const b = Buffer.from(v, 'base64');
    if (b.length < 8) return null;
    return {
      tensaoV: ((b[0]! << 8) | b[1]!) / 10,
      correnteA: ((b[2]! << 16) | (b[3]! << 8) | b[4]!) / 1000,
      potenciaW: ((b[5]! << 16) | (b[6]! << 8) | b[7]!),
    };
  } catch {
    return null;
  }
}

/** Sensor magnético de porta/janela (GA-M400A): datapoint doorcontact_state. */
export function interpretarPorta(items: TuyaStatusItem[]): TuyaLeitura {
  const aberta = items.find((i) => i.code === 'doorcontact_state')?.value;
  return { ...LEITURA_VAZIA, portaAberta: typeof aberta === 'boolean' ? aberta : null, online: null };
}

/** Sensor de presença (Presence PS10): datapoint presence_state ({none, presence}). */
export function interpretarPresenca(items: TuyaStatusItem[]): TuyaLeitura {
  const presenca = items.find((i) => i.code === 'presence_state')?.value;
  return {
    ...LEITURA_VAZIA,
    presencaDetectada: presenca === 'presence' ? true : presenca === 'none' ? false : null,
    online: null,
  };
}

/** Painel com sensor de temperatura/umidade embutido (ex: IR suite): va_temperature/va_humidity, escala 1 (÷10). */
export function interpretarTemperatura(items: TuyaStatusItem[]): TuyaLeitura {
  const temp = items.find((i) => i.code === 'va_temperature')?.value;
  const umid = items.find((i) => i.code === 'va_humidity')?.value;
  return {
    ...LEITURA_VAZIA,
    temperaturaC: typeof temp === 'number' ? temp / 10 : null,
    umidadePct: typeof umid === 'number' ? umid : null,
    online: null,
  };
}

// ---------------------------------------------------------------------------
// Infravermelho (IR) — ar-condicionado. Os controles ("remotes") são criados
// no app Smart Life dentro do aparelho infravermelho; aqui só lista e comanda.
// Precisa da API "IR Control Hub Open Service" liberada no projeto da Tuya.
// ---------------------------------------------------------------------------

export interface TuyaIrControle {
  remote_id: string;
  remote_name: string;
  /** 5 = ar-condicionado */
  category_id: number | string;
  brand_name?: string;
}

/** Controles cadastrados num aparelho infravermelho. */
export async function listarControlesIr(irDeviceId: string): Promise<TuyaIrControle[]> {
  const token = await getAccessToken();
  const r = await tuyaFetch<TuyaIrControle[] | null>('GET', `/v2.0/infrareds/${irDeviceId}/remotes`, undefined, token);
  return Array.isArray(r) ? r : [];
}

export interface ArEstado {
  ligado: boolean | null;
  temperatura: number | null;
  /** 0 frio · 1 quente · 2 automático · 3 ventilar · 4 desumidificar */
  modo: number | null;
  /** 0 automático · 1 baixo · 2 médio · 3 alto */
  vento: number | null;
}

const numOuNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Último estado que a Tuya mandou pro ar (o infravermelho não tem retorno do aparelho). */
export async function estadoAr(irDeviceId: string, remoteId: string): Promise<ArEstado> {
  const token = await getAccessToken();
  const r = await tuyaFetch<Record<string, unknown>>(
    'GET',
    `/v2.0/infrareds/${irDeviceId}/remotes/${remoteId}/ac/status`,
    undefined,
    token,
  );
  const power = numOuNull(r?.power);
  return {
    ligado: power === null ? null : power === 1,
    temperatura: numOuNull(r?.temp),
    modo: numOuNull(r?.mode),
    vento: numOuNull(r?.wind),
  };
}

export type ArCodigo = 'power' | 'mode' | 'temp' | 'wind';

/** Manda um comando pro ar-condicionado pelo infravermelho. */
export async function comandoAr(irDeviceId: string, remoteId: string, code: ArCodigo, value: number): Promise<void> {
  const token = await getAccessToken();
  await tuyaFetch<boolean>(
    'POST',
    `/v2.0/infrareds/${irDeviceId}/air-conditioners/${remoteId}/command`,
    { code, value },
    token,
  );
}

// --- Criar controle pelo sistema (sem passar pelo Smart Life) ---------------
// Marca → lista de códigos (remote_index) → testa no ar → salva com nome.

export const IR_CATEGORIA_AR = 5;

export interface TuyaIrMarca {
  brand_id: number;
  brand_name: string;
}

/** Marcas de ar-condicionado que o infravermelho conhece. */
export async function listarMarcasIr(irDeviceId: string): Promise<TuyaIrMarca[]> {
  const token = await getAccessToken();
  const r = await tuyaFetch<TuyaIrMarca[] | null>(
    'GET',
    `/v2.0/infrareds/${irDeviceId}/categories/${IR_CATEGORIA_AR}/brands`,
    undefined,
    token,
  );
  return Array.isArray(r) ? r : [];
}

/** Códigos (remote_index) de uma marca — cada um é um "controle" diferente a testar. */
export async function listarCodigosIr(irDeviceId: string, brandId: number): Promise<number[]> {
  const token = await getAccessToken();
  const r = await tuyaFetch<{ remote_index_list?: { remote_index: number }[] } | null>(
    'GET',
    `/v2.0/infrareds/${irDeviceId}/categories/${IR_CATEGORIA_AR}/brands/${brandId}/remote-indexs?page=1&size=200`,
    undefined,
    token,
  );
  return (r?.remote_index_list ?? []).map((x) => Number(x.remote_index)).filter((n) => Number.isFinite(n));
}

/** Dispara um comando de teste com um código ainda não salvo. */
export async function testarCodigoAr(irDeviceId: string, remoteIndex: number, code: ArCodigo, value: number): Promise<void> {
  const token = await getAccessToken();
  await tuyaFetch<boolean>(
    'POST',
    `/v2.0/infrareds/${irDeviceId}/air-conditioners/testing/command`,
    { remote_index: remoteIndex, category_id: IR_CATEGORIA_AR, code, value },
    token,
  );
}

/** Salva o controle no infravermelho; devolve o remote_id novo. */
export async function criarControleAr(
  irDeviceId: string,
  dados: { brandId: number; brandName: string; remoteIndex: number; nome: string },
): Promise<string> {
  const token = await getAccessToken();
  return tuyaFetch<string>(
    'POST',
    `/v2.0/infrareds/${irDeviceId}/remotes`,
    {
      category_id: IR_CATEGORIA_AR,
      brand_id: dados.brandId,
      brand_name: dados.brandName,
      remote_index: dados.remoteIndex,
      remote_name: dados.nome,
    },
    token,
  );
}
