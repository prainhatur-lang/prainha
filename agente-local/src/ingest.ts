// Cliente HTTP das APIs /api/ingest e /api/ingest/financeiro
import type {
  PagamentoIngest,
  FinanceiroIngestBatch,
} from '@concilia/shared';
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

export interface FinanceiroIngestResponse {
  fornecedoresRecebidos: number;
  categoriasRecebidas: number;
  contasBancariasRecebidas: number;
  contasPagarRecebidas: number;
}

export async function enviarFinanceiro(
  cfg: Config,
  batch: FinanceiroIngestBatch,
): Promise<FinanceiroIngestResponse> {
  const url = `${cfg.api.url.replace(/\/$/, '')}/api/ingest/financeiro`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.api.token}`,
    },
    body: JSON.stringify(batch),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${r.statusText} - ${txt.slice(0, 200)}`);
  }
  return (await r.json()) as FinanceiroIngestResponse;
}
