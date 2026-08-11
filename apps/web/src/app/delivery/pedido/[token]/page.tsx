// /delivery/pedido/[token] — acompanhamento público do pedido. Enquanto está
// pendente, é AQUI que o pagamento conclui (QR do Pix ou formulário de
// cartão); depois vira a linha do tempo do preparo/entrega.

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { StatusClient } from './status-client';

export const dynamic = 'force-dynamic';

export default async function PedidoDeliveryPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  if (!token || token.length < 20) notFound();

  const [p] = await db
    .select({ id: schema.deliveryPedido.id })
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.token, token))
    .limit(1);
  if (!p) notFound();

  return <StatusClient token={token} />;
}
