// Valor da taxa de reserva de um espaço pago (Lounge). Uma regra só pro
// site, pra Nina e pra cobrança do painel — antes cada lugar fazia a conta.
//
// Regra do dono (31/10/2026):
// - sábado, domingo E FERIADO pagam o valor de fim de semana (R$ 250);
//   os outros dias pagam o de dia útil (R$ 100);
// - no valor de fim de semana/feriado, reserva a partir das 15h tem
//   desconto de R$ 100 (R$ 250 → R$ 150).
// Arquivo sem import de servidor: o formulário do site também usa.

export const HORA_DESCONTO_LOUNGE = '15:00';
export const DESCONTO_LOUNGE_TARDE = 100;

export function ehSabadoOuDomingo(ymd: string): boolean {
  const [y, m, d] = ymd.split('-').map(Number);
  const dia = new Date(y, m - 1, d).getDay();
  return dia === 0 || dia === 6;
}

/** `feriado`: a data é feriado (quem chama resolve — servidor ou lista). */
export function valorTaxaLounge(
  taxa: { sabDom: number; diasUteis: number },
  data: string,
  hora: string | null | undefined,
  feriado = false,
): number {
  if (!(ehSabadoOuDomingo(data) || feriado)) return taxa.diasUteis;
  const h = hora ? String(hora).slice(0, 5) : null;
  if (h && h >= HORA_DESCONTO_LOUNGE) return Math.max(0, taxa.sabDom - DESCONTO_LOUNGE_TARDE);
  return taxa.sabDom;
}
