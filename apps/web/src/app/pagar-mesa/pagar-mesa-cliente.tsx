'use client';

import { useState } from 'react';
import { CreditCardForm } from '../reservar/[token]/credit-card-form';

type Params = {
  filialId: string;
  mesa: number;
  valorCentavos: number;
  ref: string;
  expira: number;
  sig: string;
};

export function PagarMesaCliente({ params, totalCents }: { params: Params; totalCents: number }) {
  const [pago, setPago] = useState(false);

  if (pago) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f7ee] text-2xl">
          ✓
        </div>
        <h2 className="mt-3 text-lg font-semibold text-[#15803d]">Pagamento aprovado</h2>
        <p className="mt-2 text-sm text-[#8a7a64]">
          Obrigado! Já avisamos a casa — pode fechar esta tela.
        </p>
      </div>
    );
  }

  // Mesma tela de cartao da reserva: 3DS, bandeiras e validacoes ja resolvidos.
  // So troca pra onde posta e leva junto os parametros assinados — o valor
  // cobrado sai deles no servidor, nao do que o browser mandar.
  return (
    <CreditCardForm
      token=""
      reservaId={params.ref}
      totalCents={totalCents}
      onPago={() => setPago(true)}
      endpointPagamento="/api/pagar-mesa/cartao"
      endpointMpiToken={`/api/pagar-mesa/mpi-token?f=${encodeURIComponent(params.filialId)}&m=${params.mesa}&v=${params.valorCentavos}&r=${encodeURIComponent(params.ref)}&e=${params.expira}&s=${encodeURIComponent(params.sig)}`}
      extraPayload={{
        f: params.filialId,
        m: params.mesa,
        v: params.valorCentavos,
        r: params.ref,
        e: params.expira,
        s: params.sig,
      }}
    />
  );
}
