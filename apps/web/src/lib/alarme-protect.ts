// Alarme do UniFi Protect armado/desarmado pelo Concilia. A nuvem não alcança
// o Protect (IP da rede da loja, chave local só vale lá dentro), então quem
// fala com ele é o servidor da loja (vendas-local): a nuvem manda o comando
// assinado (escopo 'alarme', separado de 'caixa'/'equipe') por
// filial.caixa_url, junto com host + chave do Protect — a chave mora cifrada
// aqui no banco e só viaja dentro da chamada HTTPS assinada.

import { createHmac } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { caixaUrlDaFilial } from '@/lib/caixa-loja';
import { decifrar } from '@/lib/segredo';

type Gatilho = typeof schema.alarmeGatilho.$inferSelect;

/** armMode do Protect (GET /v1/nvrs). status: disabled | arming | armed | breach… */
export interface ArmMode {
  status: string;
  armProfileId: string | null;
  armedAt: number | null;
  willBeArmedAt: number | null;
  breachDetectedAt: number | null;
  breachEventCount: number | null;
}

export type RespostaProtect = { ok: true; armMode: ArmMode } | { ok: false; erro: string };

export function protectConfigurado(g: Gatilho): boolean {
  return !!g.protectHost && !!g.protectApiKey;
}

/** "armado" pro painel: qualquer estado que não seja desligado conta como ligado. */
export function armModeLigado(m: ArmMode): boolean {
  return m.status !== 'disabled';
}

export async function chamarProtect(g: Gatilho, acao: 'status' | 'ligar' | 'desligar'): Promise<RespostaProtect> {
  if (!g.protectHost || !g.protectApiKey) return { ok: false, erro: 'Protect não configurado nesse gatilho' };
  const secret = process.env.PAGAR_MESA_SECRET;
  if (!secret || secret.length < 16) return { ok: false, erro: 'PAGAR_MESA_SECRET não configurado' };
  const base = await caixaUrlDaFilial(g.filialId);
  if (!base) return { ok: false, erro: 'filial sem endereço do servidor da loja (caixa_url)' };
  let chave: string;
  try {
    chave = decifrar(g.protectApiKey);
  } catch (e) {
    return { ok: false, erro: `chave do Protect ilegível: ${(e as Error).message}` };
  }
  const e = Math.floor(Date.now() / 1000) + 120;
  const s = createHmac('sha256', secret).update([g.filialId, 'alarme', String(e)].join('|')).digest('hex');
  try {
    const r = await fetch(`${base}/api/central/alarme/${acao}?e=${e}&s=${s}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: g.protectHost, chave }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    const data = (await r.json().catch(() => null)) as RespostaProtect | null;
    if (!data) return { ok: false, erro: `servidor da loja respondeu ${r.status}` };
    return data;
  } catch (err) {
    return { ok: false, erro: `servidor da loja não respondeu: ${(err as Error).message}` };
  }
}

/** Deixa a coluna `ativo` igual ao Protect (alguém pode ter armado pelo app do UniFi). */
export async function sincronizarAtivo(g: Gatilho, m: ArmMode): Promise<void> {
  const ligado = armModeLigado(m);
  if (g.ativo === ligado) return;
  await db
    .update(schema.alarmeGatilho)
    .set({ ativo: ligado, ativoAlteradoPor: 'UniFi Protect', ativoAlteradoEm: new Date(), atualizadoEm: new Date() })
    .where(eq(schema.alarmeGatilho.id, g.id));
}

/** Gatilho pra devolver ao navegador: sem a chave, só se ela existe. */
export function gatilhoPublico(g: Gatilho) {
  const { protectApiKey, ...resto } = g;
  return { ...resto, protectChaveSalva: !!protectApiKey };
}

/** Host do Protect tem que ser IP da rede interna — o servidor da loja recusa o resto. */
export function hostProtectValido(h: string): boolean {
  return /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(h);
}
