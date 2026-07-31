/**
 * Cliente da API Cielo E-commerce 3.0 — adaptado do projeto compre-daqui
 * (mesma integração já validada em produção pela CDL Aracaju, 07/2026).
 *
 * Docs: https://docs.cielo.com.br/ecommerce-cielo
 *
 * PIX e cartão (com 3DS via Braspag MPI) em uso na taxa de reserva do
 * Lounge. IMPORTANTE (lição do chamado técnico do compre-daqui com a
 * Cielo): 3DS autenticar com sucesso NÃO garante que a cobrança vai
 * passar — se o EC tiver o produto cartão contratado mas não ativado
 * TRANSACIONALMENTE, a venda cai com "002 Credenciais Inválidas" mesmo
 * com o banco pré-autorizando. Se isso acontecer aqui, o problema é
 * ativação da conta na Cielo, não bug de integração.
 */

const isSandbox = process.env.CIELO_SANDBOX === 'true';

const PIX_PROVIDER = process.env.CIELO_PIX_PROVIDER || 'Cielo';

const API_URL = isSandbox
  ? 'https://apisandbox.cieloecommerce.cielo.com.br'
  : 'https://api.cieloecommerce.cielo.com.br';

const QUERY_URL = isSandbox
  ? 'https://apiquerysandbox.cieloecommerce.cielo.com.br'
  : 'https://apiquery.cieloecommerce.cielo.com.br';

function headers() {
  return {
    'Content-Type': 'application/json',
    MerchantId: process.env.CIELO_MERCHANT_ID || '',
    MerchantKey: process.env.CIELO_MERCHANT_KEY || '',
  };
}

// ============================================
// Criar transação PIX
// ============================================

export async function createCieloPixPayment(params: {
  orderId: string;
  amount: number; // em centavos
  customerName: string;
  customerCpf?: string;
}) {
  const res = await fetch(`${API_URL}/1/sales/`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      MerchantOrderId: params.orderId,
      Customer: {
        Name: params.customerName,
        Identity: params.customerCpf?.replace(/\D/g, '') || undefined,
        IdentityType: params.customerCpf ? 'CPF' : undefined,
      },
      Payment: {
        Type: 'Pix',
        Provider: PIX_PROVIDER,
        Amount: params.amount,
      },
    }),
  });

  const responseText = await res.text();
  console.log('Cielo PIX response:', res.status, responseText.substring(0, 300));

  if (!res.ok) {
    throw new Error(`Cielo PIX erro: ${res.status} - ${responseText.substring(0, 200)}`);
  }

  const data = JSON.parse(responseText);
  const payment = data.Payment;

  return {
    paymentId: payment.PaymentId as string,
    status: mapCieloStatus(payment.Status),
    qrCodeBase64: (payment.QrcodeBase64Image || payment.QrCodeBase64Image || '') as string,
    qrCodeString: (payment.QrCodeString || payment.QrcodeString || '') as string,
  };
}

// ============================================
// Cartão de crédito — DORMENTE, falta CIELO_3DS_CLIENT_ID/SECRET
// ============================================

export type ThreeDSData = {
  Cavv: string;
  Eci: string;
  Xid?: string;
  Version?: string; // "2"
  ReferenceID?: string;
};

export async function createCieloCardPayment(params: {
  orderId: string;
  amount: number; // em centavos
  customerName: string;
  customerEmail?: string;
  customerCpf?: string;
  cardNumber: string;
  holder: string;
  expirationDate: string; // MM/YYYY
  securityCode: string;
  brand: string;
  installments: number;
  paymentType?: 'CreditCard' | 'DebitCard';
  threeDS?: ThreeDSData;
  billingAddress?: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    cep: string;
  };
}) {
  const paymentType = params.paymentType || 'CreditCard';
  const hasThreeDS = !!(params.threeDS && params.threeDS.Cavv && params.threeDS.Eci);

  const body: Record<string, unknown> = {
    MerchantOrderId: params.orderId,
    Customer: {
      Name: params.customerName,
      Email: params.customerEmail,
      Identity: params.customerCpf?.replace(/\D/g, '') || undefined,
      IdentityType: params.customerCpf ? 'CPF' : undefined,
      Address: params.billingAddress
        ? {
            Street: params.billingAddress.street,
            Number: params.billingAddress.number,
            District: params.billingAddress.neighborhood,
            City: params.billingAddress.city,
            State: params.billingAddress.state,
            ZipCode: params.billingAddress.cep.replace(/\D/g, ''),
            Country: 'BRA',
          }
        : undefined,
    },
    Payment: {
      Type: paymentType,
      Amount: params.amount,
      Installments: paymentType === 'DebitCard' ? 1 : params.installments || 1,
      Capture: paymentType === 'CreditCard' ? true : undefined,
      Authenticate: hasThreeDS ? true : undefined,
      CreditCard:
        paymentType === 'CreditCard'
          ? {
              CardNumber: params.cardNumber.replace(/\D/g, ''),
              Holder: params.holder,
              ExpirationDate: params.expirationDate,
              SecurityCode: params.securityCode,
              Brand: params.brand,
            }
          : undefined,
      ExternalAuthentication: hasThreeDS
        ? {
            Cavv: params.threeDS!.Cavv,
            Xid: params.threeDS!.Xid,
            Eci: params.threeDS!.Eci,
            Version: params.threeDS!.Version || '2',
            ReferenceID: params.threeDS!.ReferenceID,
          }
        : undefined,
    },
  };

  const res = await fetch(`${API_URL}/1/sales/`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  const responseText = await res.text();
  console.log('Cielo Card response:', res.status, responseText.substring(0, 300));

  if (!res.ok) {
    throw new Error(`Cielo Card erro: ${res.status} - ${responseText.substring(0, 200)}`);
  }

  const data = JSON.parse(responseText);
  const payment = data.Payment;

  return {
    paymentId: payment.PaymentId as string,
    status: mapCieloStatus(payment.Status),
    statusDetail: (payment.ReturnMessage || '') as string,
    returnCode: (payment.ReturnCode || '') as string,
  };
}

// ============================================
// Consultar transação
// ============================================

export async function queryCieloPayment(paymentId: string) {
  const res = await fetch(`${QUERY_URL}/1/sales/${paymentId}`, {
    method: 'GET',
    headers: headers(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cielo Query erro: ${res.status} - ${err}`);
  }

  const data = await res.json();
  const payment = data.Payment;

  return {
    paymentId: payment.PaymentId as string,
    status: mapCieloStatus(payment.Status),
    statusDetail: (payment.ReturnMessage || '') as string,
  };
}

// ============================================
// Cancelar/Reembolsar pagamento
// ============================================

export async function refundCieloPayment(paymentId: string, amountCents?: number) {
  const url = amountCents
    ? `${API_URL}/1/sales/${paymentId}/void?amount=${amountCents}`
    : `${API_URL}/1/sales/${paymentId}/void`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: headers(),
  });

  const responseText = await res.text();
  console.log('Cielo Refund response:', res.status, responseText.substring(0, 300));

  if (!res.ok) {
    throw new Error(`Cielo Refund erro: ${res.status} - ${responseText.substring(0, 200)}`);
  }

  const data = JSON.parse(responseText);
  return {
    status: data.Status === 10 || data.Status === 11 ? 'reembolsado' : 'pendente',
  };
}

// ============================================
// Mapear status Cielo → nosso sistema
// ============================================

function mapCieloStatus(cieloStatus: number): 'pendente' | 'pago' | 'reembolsado' {
  switch (cieloStatus) {
    case 1: // Authorized
    case 2: // PaymentConfirmed
      return 'pago';
    case 10: // Voided
    case 11: // Refunded
    case 13: // Aborted
      return 'reembolsado';
    default: // 0=NotFinished, 3=Denied, 12=Pending
      return 'pendente';
  }
}

// ============================================
// Mensagens de erro amigáveis (ReturnCode da Cielo)
// ============================================

export function friendlyCieloError(returnCode: string): string {
  const messages: Record<string, string> = {
    '000': 'Transação autorizada com sucesso.',
    '002': 'Transação não permitida. Verifique com a Cielo se o cartão está habilitado nessa conta.',
    '003': 'Erro na comunicação. Tente novamente.',
    '005': 'Transação não autorizada. Entre em contato com o banco.',
    '006': 'Transação não autorizada. Tente novamente.',
    '009': 'Transação parcialmente cancelada.',
    '012': 'Transação inválida. Revise os dados.',
    '014': 'Cartão inválido. Verifique os dados.',
    '041': 'Cartão bloqueado. Entre em contato com o banco.',
    '051': 'Saldo insuficiente.',
    '054': 'Cartão vencido.',
    '057': 'Transação não permitida para este cartão.',
    '058': 'Transação não permitida para este terminal.',
    '062': 'Cartão restrito.',
    '063': 'Regras de segurança violadas.',
    '065': 'Limite de tentativas excedido.',
    '077': 'Cartão cancelado.',
    '078': 'Cartão não foi desbloqueado.',
    '099': 'Timeout. Tente novamente.',
    N7: 'Código de segurança inválido.',
    BV: 'Cartão vencido.',
    BP: 'Transação não permitida.',
  };
  return messages[returnCode] || `Pagamento recusado (${returnCode}). Tente outro cartão ou pague via Pix.`;
}

// ============================================
// 3DS — autenticação Braspag MPI (Merchant Plug-in)
// ============================================

const MPI_BASE_URL = isSandbox ? 'https://mpisandbox.braspag.com.br' : 'https://mpi.braspag.com.br';

export async function getCieloMpiAccessToken(): Promise<string> {
  const clientId = process.env.CIELO_3DS_CLIENT_ID || '';
  const clientSecret = process.env.CIELO_3DS_CLIENT_SECRET || '';
  const establishmentCode = process.env.CIELO_3DS_ESTABLISHMENT_CODE || process.env.CIELO_MERCHANT_ID || '';
  const merchantName = process.env.CIELO_3DS_MERCHANT_NAME || 'Prainha';
  const mcc = process.env.CIELO_3DS_MCC || '5812';

  if (!clientId || !clientSecret) {
    throw new Error('CIELO_3DS_CLIENT_ID / CIELO_3DS_CLIENT_SECRET nao configurados');
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${MPI_BASE_URL}/v2/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
    body: JSON.stringify({ EstablishmentCode: establishmentCode, MerchantName: merchantName, MCC: mcc }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cielo MPI auth erro: ${res.status} - ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  return data.access_token;
}

/** Config pública do MPI pro frontend usar em window.bpmpi_config. */
export function getCieloMpiPublicConfig() {
  return {
    establishmentCode: process.env.CIELO_3DS_ESTABLISHMENT_CODE || process.env.CIELO_MERCHANT_ID || '',
    merchantName: process.env.CIELO_3DS_MERCHANT_NAME || 'Prainha',
    mcc: process.env.CIELO_3DS_MCC || '5812',
    environment: isSandbox ? 'SDB' : 'PRD',
    scriptUrl: isSandbox
      ? 'https://mpisandbox.braspag.com.br/Scripts/BP.Mpi.3ds20.min.js'
      : 'https://mpi.braspag.com.br/Scripts/BP.Mpi.3ds20.min.js',
  };
}
