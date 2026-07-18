// Chamadas best-effort pra API do concilia (nuvem). Nunca bloqueia a
// cancela — falha de rede aqui não pode travar a entrada do cliente.
import { log } from './logger.js';

export interface ConciliaApiCfg {
  url: string;
  token: string;
}

/** Avisa o concilia que essa placa entrou — se bater com a placa de alguma
 *  reserva ativa de hoje, a tela /reservas (quando aberta) toca um som
 *  avisando a recepção. Best-effort: nunca lança, só loga. */
export async function avisarChegadaPlaca(cfg: ConciliaApiCfg, placa: string): Promise<void> {
  try {
    const r = await fetch(`${cfg.url.replace(/\/$/, '')}/api/patio/chegada`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ placa }),
    });
    if (!r.ok) {
      log.warn('aviso de chegada falhou', { status: r.status });
      return;
    }
    const data = (await r.json().catch(() => ({}))) as { bateu?: boolean };
    if (data.bateu) log.info('placa bateu com reserva — recepcao avisada', { placa });
  } catch (e) {
    log.warn('aviso de chegada falhou (rede)', { err: (e as Error).message });
  }
}
