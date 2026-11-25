'use client';

import { useState } from 'react';
import { CreditCardForm } from '../../reservar/[token]/credit-card-form';

export function CobrancaCliente({
  token,
  referencia,
  totalCents,
  msgSem3ds,
}: {
  token: string;
  referencia: string;
  totalCents: number;
  msgSem3ds: string;
}) {
  const [pago, setPago] = useState(false);

  if (pago) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f7ee] text-2xl">
          ✓
        </div>
        <h2 className="mt-3 text-lg font-semibold text-[#15803d]">Pagamento aprovado</h2>
        <p className="mt-2 text-sm text-[#8a7a64]">Obrigado! Já avisamos a casa — pode fechar esta tela.</p>
      </div>
    );
  }

  // Mesma tela de cartão da reserva e do QR da mesa. Aqui o 3DS é obrigatório:
  // sem autenticação do banco, nem envia (e o servidor recusa de qualquer jeito).
  const base = `/api/link-pagamento/${encodeURIComponent(token)}`;
  return (
    <CreditCardForm
      token=""
      reservaId={referencia}
      totalCents={totalCents}
      onPago={() => setPago(true)}
      endpointPagamento={`${base}/cartao`}
      endpointMpiToken={`${base}/mpi-token`}
      exigir3ds={msgSem3ds}
    />
  );
}
