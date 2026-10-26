// /delivery/pedido/[token] — acompanhamento público do pedido. Enquanto está
// pendente, é AQUI que o pagamento conclui (QR do Pix ou formulário de
// cartão); depois vira a linha do tempo do preparo/entrega.
//
// ?lang=en|es|fr|it (o cardápio manda junto depois do pedido): tela no idioma
// do cliente e nomes de prato/complemento da mesma tabela traducao_texto do
// cardápio. Sem lang, o português de sempre e nenhuma consulta a mais.

import { notFound } from 'next/navigation';
import { after } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { StatusClient } from './status-client';
import { temaDeliveryDaFilial, estiloTemaDelivery } from '@/lib/tema-delivery';
import { idiomaDe } from '@/lib/delivery/idioma';
import { MAX_CHARS, preencherTraducoes, traducoesSalvas } from '@/lib/traduzir-cardapio';

export const dynamic = 'force-dynamic';

export default async function PedidoDeliveryPage(props: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const { token } = await props.params;
  if (!token || token.length < 20) notFound();
  const lang = idiomaDe((await props.searchParams).lang);

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

  // Nome do prato e do complemento no idioma do cliente. São os mesmos textos
  // do cardápio, então quase sempre já estão traduzidos; o que faltar vai pra
  // IA depois de responder e aparece no próximo carregamento.
  const traducoes: Record<string, string> = {};
  if (lang !== 'pt') {
    const itens = await db
      .select({
        nome: schema.deliveryPedidoItem.nome,
        complementos: schema.deliveryPedidoItem.complementos,
      })
      .from(schema.deliveryPedidoItem)
      .where(eq(schema.deliveryPedidoItem.pedidoId, p.id))
      .catch(() => []);
    const textos = itens.flatMap((i) => [i.nome, ...(i.complementos ?? []).map((c) => c.nome)]);
    const mapa = await traducoesSalvas(textos, lang).catch(() => new Map<string, string>());
    for (const [pt, tr] of mapa) traducoes[pt] = tr;
    const faltando = [...new Set(textos.map((t) => (t ?? '').trim()))].filter(
      (t) => t && t.length <= MAX_CHARS && !mapa.has(t),
    );
    if (faltando.length) after(() => preencherTraducoes(faltando));
  }

  return (
    <div style={estiloTemaDelivery(tema) as React.CSSProperties} className="min-h-screen">
      <StatusClient token={token} lang={lang} traducoes={traducoes} />
    </div>
  );
}
