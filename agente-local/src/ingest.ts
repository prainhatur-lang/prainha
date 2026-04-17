// Cliente HTTP da API /api/ingest
import type { PagamentoIngest } from '@concilia/shared';
import type { Config } from './config';

export interface IngestResponse {
  recebidos: number;
  ultimoCodigoExterno: number | null;
}

export async function enviarBatch(
  cfg: Config,
  pagamentos: PagamentoIngest[],
): Promise<IngestResponse> {
  const url = `${cfg.api.url.replace(/\/$/, '')}/api/ingest`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.api.token}`,
    },
    body: JSON.stringify({ pagamentos }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${r.statusText} - ${txt.slice(0, 200)}`);
  }
  return (await r.json()) as IngestResponse;
}
