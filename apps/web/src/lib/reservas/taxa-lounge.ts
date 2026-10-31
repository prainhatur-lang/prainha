// Valor da taxa de reserva de um espaço pago (Lounge). Uma regra só pro
// site, pra Nina e pra cobrança do painel — antes cada lugar fazia a conta.
//
// Regra do dono (31/10/2026):
// - sábado, domingo E FERIADO pagam o valor de fim de semana (R$ 250);
//   os outros dias pagam o de dia útil (R$ 100);
// - ÚLTIMA HORA: no próprio dia, se deu 15h e o lounge está VAZIO (nenhuma
//   reserva no dia e ninguém sentado), baixa R$ 100 (R$ 250 → R$ 150) pra
//   tentar fechar. Não é pela hora da reserva — é a casa vendendo o lounge
//   que ia ficar parado. Quem decide se está vazio é o servidor
//   (loungesVaziosAgora em lib/reservas/cobrar-taxa).
// Arquivo sem import de servidor: o formulário do site também usa.

export const HORA_ULTIMA_HORA_LOUNGE = '15:00';
export const DESCONTO_LOUNGE_ULTIMA_HORA = 100;

export function ehSabadoOuDomingo(ymd: string): boolean {
  const [y, m, d] = ymd.split('-').map(Number);
  const dia = new Date(y, m - 1, d).getDay();
  return dia === 0 || dia === 6;
}

/** `feriado`: a data é feriado. `ultimaHora`: hoje, depois das 15h, lounge vazio. */
export function valorTaxaLounge(
  taxa: { sabDom: number; diasUteis: number },
  data: string,
  feriado = false,
  ultimaHora = false,
): number {
  if (!(ehSabadoOuDomingo(data) || feriado)) return taxa.diasUteis;
  return ultimaHora ? Math.max(0, taxa.sabDom - DESCONTO_LOUNGE_ULTIMA_HORA) : taxa.sabDom;
}
