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
}

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
  return {
    ligado: typeof switchVal === 'boolean' ? switchVal : null,
    potenciaW: typeof power === 'number' ? power / 10 : null,
    tensaoV: typeof voltage === 'number' ? voltage / 10 : null,
    correnteA: typeof current === 'number' ? current / 1000 : null,
    energiaKwh: typeof energy === 'number' ? energy / 100 : null,
    online: null,
  };
}
