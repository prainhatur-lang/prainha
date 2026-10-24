import { brl } from '@/lib/format';

/**
 * Saldo do fiado (conta corrente) sempre escrito por extenso, pra não haver
 * confusão: positivo = o cliente DEVE à casa; negativo = CRÉDITO do cliente
 * (ex.: permuta abatida a mais). "R$ -7.181,17" sozinho ninguém lê certo, e
 * no Consumer a coluna "CRÉDITO" é o consumo (dívida), o que piora.
 */
export function fiadoSaldoTexto(v: number | string | null | undefined): string {
  const n = Number(v ?? 0) || 0;
  if (n > 0.009) return `cliente deve ${brl(n)}`;
  if (n < -0.009) return `crédito do cliente ${brl(-n)}`;
  return 'sem saldo (não deve nada)';
}
