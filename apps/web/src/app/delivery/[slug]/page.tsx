// /delivery/[slug] — cardápio público da loja + carrinho + checkout.
// Server component: carrega loja/categorias/itens e o status "aberta agora";
// o resto (sacola, endereço, agendamento, cupom, pagamento) é o client.

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';
import { lojaDeliveryPorSlug, abertaAgora, agendaDelivery } from '@/lib/delivery/config';
import { saldosDasVariantes, semDisponibilidade } from '@/lib/delivery/estoque';
import { CardapioClient } from './cardapio-client';
import { temaDeliveryDaFilial, estiloTemaDelivery } from '@/lib/tema-delivery';

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
      varianteId: schema.deliveryItem.varianteId,
      checarEstoque: schema.deliveryItem.checarEstoque,
    })
    .from(schema.deliveryItem)
    .where(
      and(eq(schema.deliveryItem.filialId, loja.filialId), eq(schema.deliveryItem.ativo, true)),
    )
    .orderBy(asc(schema.deliveryItem.ordem), asc(schema.deliveryItem.nome));

  // Estoque real do Consumer: item vinculado a produto que controla estoque e
  // está zerado sai como esgotado sozinho, sem ninguém marcar no painel.
  const saldos = await saldosDasVariantes(
    loja.filialId,
    itens.filter((i) => i.checarEstoque && i.varianteId).map((i) => i.varianteId!),
  );

  // PERGUNTAS do Consumer (WIZARD): é assim que a casa monta o pedido —
  // "Qual o ponto da carne" (obrigatória) e "Deseja mais algum acompanhamento"
  // (opcional), cada opção com PRECOPROMO, o preço quando vai junto do prato.
  const perguntas = await db
    .select({
      itemId: schema.deliveryItem.id,
      perguntaCodigo: schema.wizardPergunta.codigoExterno,
      texto: schema.wizardPergunta.texto,
      min: schema.wizardPergunta.respostasMin,
      max: schema.wizardPergunta.respostasMax,
      ordem: schema.wizardProduto.ordem,
    })
    .from(schema.deliveryItem)
    .innerJoin(
      schema.wizardProduto,
      and(
        eq(schema.wizardProduto.filialId, loja.filialId),
        eq(schema.wizardProduto.varianteId, schema.deliveryItem.varianteId),
      ),
    )
    .innerJoin(
      schema.wizardPergunta,
      and(
        eq(schema.wizardPergunta.filialId, loja.filialId),
        eq(schema.wizardPergunta.codigoExterno, schema.wizardProduto.codigoPergunta),
      ),
    )
    .where(eq(schema.deliveryItem.filialId, loja.filialId))
    .orderBy(asc(schema.wizardProduto.ordem), asc(schema.wizardPergunta.codigoExterno));

  const opcoesWizard = await db
    .select({
      id: schema.wizardOpcao.id,
      perguntaCodigo: schema.wizardOpcao.codigoPergunta,
      nome: schema.wizardOpcao.nome,
      preco: schema.wizardOpcao.precoPromo,
    })
    .from(schema.wizardOpcao)
    .where(eq(schema.wizardOpcao.filialId, loja.filialId))
    .orderBy(asc(schema.wizardOpcao.nome));

  const { dias, asapDisponivel } = agendaDelivery(loja.config);
  const c = loja.config;

  // O delivery da Tabuará não pode abrir na cara do Prainha — é a mesma marca
  // que o cliente acabou de ver no site. Aqui a paleta e o par de fontes.
  const tema = temaDeliveryDaFilial(loja.nome);

  return (
    <div style={estiloTemaDelivery(tema) as React.CSSProperties} className="min-h-screen">
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
        naEntregaAtivo: c.naEntregaAtivo === true,
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
            esgotado: semDisponibilidade(i, saldos),
            destaque: i.destaque,
            perguntas: perguntas
              .filter((q) => q.itemId === i.id)
              .map((q) => ({
                codigo: q.perguntaCodigo,
                texto: q.texto ?? 'Escolha uma opção',
                // max 0 no Consumer = sem limite de respostas.
                min: q.min ?? 0,
                max: q.max ?? 0,
                opcoes: opcoesWizard
                  .filter((o) => o.perguntaCodigo === q.perguntaCodigo)
                  .map((o) => ({
                    id: o.id,
                    nome: o.nome ?? '',
                    precoCentavos: Math.round(Number(o.preco) * 100),
                  }))
                  .filter((o) => o.nome),
              }))
              .filter((q) => q.opcoes.length > 0),
          })),
      }))}
      agendaInicial={{ dias, asapDisponivel }}
    />
    </div>
  );
}
