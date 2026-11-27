// Código que dá pra pagar pela tela /financeiro/pagar-conta, tirado da
// observação da conta a pagar: guia que o contador subiu / boleto lançado
// ("Código de barras: …") ou conta lançada como QR / copia-e-cola
// ("Pix copia-e-cola: 000201…", recarga da Meta 26/11/2026).
// Um lugar só pra regra: a tela Pagar conta e a lista do Contas a pagar
// (dono 27/11/2026) têm que concordar sobre o que é "pagável por código".

/** Status do pagamento pela tela que tiram a conta do "Pagar esta". */
export const STATUS_PAGAMENTO_EM_ANDAMENTO = ['ENVIANDO', 'APROVACAO', 'AGENDADO', 'PAGO'] as const;

export function codigoPagavelDaConta(
  descricao: string | null | undefined,
  observacao: string | null | undefined,
): string | null {
  // repasse entre casas não paga a guia (quem paga é a pagadora)
  if ((descricao ?? '').startsWith('Repasse ')) return null;
  return (
    observacao?.match(/C[óo]digo de barras:\s*(\d{44,48})/)?.[1] ??
    // o copia-e-cola tem espaço (nome do favorecido): vai até o fim da linha
    observacao?.match(/Pix copia-e-cola:\s*(000201[^\n\r]+)/)?.[1] ??
    null
  );
}
