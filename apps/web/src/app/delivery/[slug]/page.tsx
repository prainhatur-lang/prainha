// /delivery/[slug] — cardápio público da loja + carrinho + checkout.
// Server component: carrega loja/categorias/itens e o status "aberta agora";
// o resto (sacola, endereço, agendamento, cupom, pagamento) é o client.

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';
import { lojaDeliveryPorSlug, abertaAgora, agendaDelivery } from '@/lib/delivery/config';
import { CardapioClient } from './cardapio-client';

export const dynamic = 'force-dynamic';

export default async function DeliveryLojaPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const loja = await lojaDeliveryPorSlug(slug);
  if (!loja) notFound();

  const categorias = await db
    .select({
      id: schema.deliveryCategoria.id,
      nome: schema.deliveryCategoria.nome,
    })
    .from(schema.deliveryCategoria)
    .where(
      and(
        eq(schema.deliveryCategoria.filialId, loja.filialId),
        eq(schema.deliveryCategoria.ativo, true),
      ),
    )
    .orderBy(asc(schema.deliveryCategoria.ordem), asc(schema.deliveryCategoria.nome));

  const itens = await db
    .select({
      id: schema.deliveryItem.id,
      categoriaId: schema.deliveryItem.categoriaId,
      nome: schema.deliveryItem.nome,
      descricao: schema.deliveryItem.descricao,
      preco: schema.deliveryItem.preco,
      fotoUrl: schema.deliveryItem.fotoUrl,
      esgotado: schema.deliveryItem.esgotado,
      destaque: schema.deliveryItem.destaque,
      ordem: schema.deliveryItem.ordem,
    })
    .from(schema.deliveryItem)
    .where(
      and(eq(schema.deliveryItem.filialId, loja.filialId), eq(schema.deliveryItem.ativo, true)),
    )
    .orderBy(asc(schema.deliveryItem.ordem), asc(schema.deliveryItem.nome));

  const { dias, asapDisponivel } = agendaDelivery(loja.config);
  const c = loja.config;

  return (
    <CardapioClient
      slug={slug}
      loja={{
        titulo: c.titulo ?? loja.nome,
        subtitulo: c.subtitulo ?? null,
        avisoTopo: c.avisoTopo ?? null,
        whatsapp: c.whatsapp ?? null,
        pausado: c.pausado === true,
        abertaAgora: abertaAgora(c),
        retiradaAtiva: c.retiradaAtiva !== false,
        entregaAtiva: c.entregaAtiva !== false,
        pixAtivo: c.pixAtivo !== false,
        cartaoAtivo: c.cartaoAtivo !== false,
        pedidoMinimo: c.pedidoMinimo ?? null,
        gratisAcimaDe: c.gratisAcimaDe ?? null,
        gratisAteKm: c.gratisAteKm ?? null,
        gratisPrimeiraCompra: c.gratisPrimeiraCompra === true,
        tempoPreparoMin: c.tempoPreparoMin ?? null,
        tempoPreparoMax: c.tempoPreparoMax ?? null,
        cidade: c.endereco?.cidade ?? 'Aracaju',
        uf: c.endereco?.uf ?? 'SE',
      }}
      categorias={categorias.map((cat) => ({
        ...cat,
        itens: itens
          .filter((i) => i.categoriaId === cat.id)
          .map((i) => ({
            id: i.id,
            nome: i.nome,
            descricao: i.descricao,
            precoCentavos: Math.round(Number(i.preco) * 100),
            fotoUrl: i.fotoUrl,
            esgotado: i.esgotado,
            destaque: i.destaque,
          })),
      }))}
      agendaInicial={{ dias, asapDisponivel }}
    />
  );
}
