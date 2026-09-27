/**
 * Gatilho de alarme -> Tuya. Um alarme externo (UniFi Protect, ação Webhook)
 * chama /api/energia/alarme/<token> e a gente liga/desliga os dispositivos
 * Tuya do gatilho. Com desligarAposMin, o cron /api/cron/alarme-desligar
 * reverte depois de N minutos sem novo disparo.
 */

import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import crypto from 'node:crypto';
import { sendCommands } from '@/lib/tuya';

type Gatilho = typeof schema.alarmeGatilho.$inferSelect;

export function novoTokenGatilho(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Manda o comando pros dispositivos do gatilho. Canais do mesmo aparelho
 * (switch_1..4 do disjuntor de 4 seções) vão num comando só.
 * Retorna um resumo legível ("3/3 ok" ou os erros).
 */
export async function aplicarNosDispositivos(gatilho: Gatilho, ligar: boolean): Promise<string> {
  if (gatilho.dispositivoIds.length === 0) return 'nenhum dispositivo no gatilho';
  const dispositivos = await db
    .select()
    .from(schema.tuyaDispositivo)
    .where(
      and(
        inArray(schema.tuyaDispositivo.id, gatilho.dispositivoIds),
        eq(schema.tuyaDispositivo.filialId, gatilho.filialId),
        eq(schema.tuyaDispositivo.ativo, true),
      ),
    );
  if (dispositivos.length === 0) return 'dispositivos do gatilho não encontrados/inativos';

  const porAparelho = new Map<string, { nomes: string[]; codigos: string[] }>();
  for (const d of dispositivos) {
    const g = porAparelho.get(d.tuyaDeviceId) ?? { nomes: [], codigos: [] };
    g.nomes.push(d.nome);
    g.codigos.push(d.codigoSwitch);
    porAparelho.set(d.tuyaDeviceId, g);
  }

  const resultados = await Promise.allSettled(
    [...porAparelho.entries()].map(([deviceId, g]) =>
      sendCommands(
        deviceId,
        g.codigos.map((code) => ({ code, value: ligar })),
      ),
    ),
  );
  const erros: string[] = [];
  [...porAparelho.values()].forEach((g, i) => {
    const r = resultados[i];
    if (r.status === 'rejected') erros.push(`${g.nomes.join(', ')}: ${(r.reason as Error).message}`);
  });
  const acao = ligar ? 'ligou' : 'desligou';
  if (erros.length === 0) return `${acao} ${dispositivos.length} dispositivo(s)`;
  return `${acao} com erro — ${erros.join(' | ')}`;
}

/** Disparo vindo do webhook do alarme. */
export async function dispararGatilho(gatilho: Gatilho, payload: unknown): Promise<string> {
  const ligar = gatilho.acao !== 'desligar';
  const resultado = await aplicarNosDispositivos(gatilho, ligar);
  const agora = new Date();
  await db
    .update(schema.alarmeGatilho)
    .set({
      disparos: gatilho.disparos + 1,
      ultimoDisparoEm: agora,
      ultimoResultado: resultado,
      ultimoPayload: payload ?? null,
      reverterEm: gatilho.desligarAposMin
        ? new Date(agora.getTime() + gatilho.desligarAposMin * 60_000)
        : null,
    })
    .where(eq(schema.alarmeGatilho.id, gatilho.id));
  return resultado;
}
