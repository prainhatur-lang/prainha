// /delivery/pedido/[token] — acompanhamento público do pedido. Enquanto está
// pendente, é AQUI que o pagamento conclui (QR do Pix ou formulário de
// cartão); depois vira a linha do tempo do preparo/entrega.

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { StatusClient } from './status-client';
import { temaDeliveryDaFilial, estiloTemaDelivery } from '@/lib/tema-delivery';

export const dynamic = 'force-dynamic';

export default async function PedidoDeliveryPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  if (!token || token.length < 20) notFound();

  const [p] = await db
    .select({ id: schema.deliveryPedido.id, filialNome: schema.filial.nome })
    .from(schema.deliveryPedido)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.deliveryPedido.filialId))
    .where(eq(schema.deliveryPedido.token, token))
    .limit(1);
  if (!p) notFound();

  // Acompanhar o pedido é a última tela que o cliente vê — tem que continuar
  // sendo a casa de quem ele pediu, não o bege do Prainha.
  const tema = temaDeliveryDaFilial(p.filialNome);

  return (
    <div style={estiloTemaDelivery(tema) as React.CSSProperties} className="min-h-screen">
      <StatusClient token={token} />
    </div>
  );
}
