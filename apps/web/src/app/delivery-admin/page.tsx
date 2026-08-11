// /delivery-admin — painel de pedidos do delivery (equipe). Mostra a fila do
// dia, toca um sino quando entra pedido pago e move o pedido pelos status.

import { redirect } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { AppHeader } from '@/components/app-header';
import { diasAtrasBr } from '@/lib/datas';
import { PedidosClient } from './pedidos-client';

export const dynamic = 'force-dynamic';

const ABERTOS = ['pago', 'em_preparo', 'pronto', 'saiu_entrega'];

export default async function DeliveryAdminPage(props: {
  searchParams: Promise<{ f?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'delivery.read');
  const podeAtualizar = await podeUsuario(user.id, 'delivery.update');
  const podeConfigurar = await podeUsuario(user.id, 'delivery.configurar');

  const acessiveis = await filiaisDoUsuario(user.id);
  const filialIds = acessiveis.map((f) => f.id);
  const { f } = await props.searchParams;
  const filialFiltro = f && filialIds.includes(f) ? f : null;
  const escopo = filialFiltro ? [filialFiltro] : filialIds;

  if (escopo.length === 0) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-sm text-slate-500">Nenhuma filial disponível.</p>
        </section>
      </main>
    );
  }

  // Fila: tudo que está aberto + os concluídos/cancelados dos últimos 2 dias.
  const desde = diasAtrasBr(2);
  const pedidos = await db
    .select({
      id: schema.deliveryPedido.id,
      numero: schema.deliveryPedido.numero,
      filialId: schema.deliveryPedido.filialId,
      clienteNome: schema.deliveryPedido.clienteNome,
      clienteTelefone: schema.deliveryPedido.clienteTelefone,
      tipo: schema.deliveryPedido.tipo,
      endereco: schema.deliveryPedido.endereco,
      distanciaKm: schema.deliveryPedido.distanciaKm,
      agendadoData: schema.deliveryPedido.agendadoData,
      agendadoHora: schema.deliveryPedido.agendadoHora,
      asap: schema.deliveryPedido.asap,
      subtotal: schema.deliveryPedido.subtotal,
      taxaEntrega: schema.deliveryPedido.taxaEntrega,
      desconto: schema.deliveryPedido.desconto,
      total: schema.deliveryPedido.total,
      cupomCodigo: schema.deliveryPedido.cupomCodigo,
      freteGratisMotivo: schema.deliveryPedido.freteGratisMotivo,
      status: schema.deliveryPedido.status,
      pagamentoMetodo: schema.deliveryPedido.pagamentoMetodo,
      observacao: schema.deliveryPedido.observacao,
      canceladoMotivo: schema.deliveryPedido.canceladoMotivo,
      criadoEm: sql<string>`${schema.deliveryPedido.criadoEm}::text`,
      pagoEm: sql<string>`${schema.deliveryPedido.pagoEm}::text`,
    })
    .from(schema.deliveryPedido)
    .where(
      and(
        inArray(schema.deliveryPedido.filialId, escopo),
        or(
          inArray(schema.deliveryPedido.status, ABERTOS),
          gte(schema.deliveryPedido.agendadoData, desde),
        ),
      ),
    )
    .orderBy(desc(schema.deliveryPedido.criadoEm))
    .limit(200);

  const itens =
    pedidos.length > 0
      ? await db
          .select({
            pedidoId: schema.deliveryPedidoItem.pedidoId,
            nome: schema.deliveryPedidoItem.nome,
            qtd: schema.deliveryPedidoItem.qtd,
            total: schema.deliveryPedidoItem.total,
            obs: schema.deliveryPedidoItem.obs,
          })
          .from(schema.deliveryPedidoItem)
          .where(
            inArray(
              schema.deliveryPedidoItem.pedidoId,
              pedidos.map((p) => p.id),
            ),
          )
      : [];

  const lojas = await db
    .select({ id: schema.filial.id, config: schema.filial.deliveryConfig })
    .from(schema.filial)
    .where(inArray(schema.filial.id, filialIds));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <PedidosClient
        pedidos={pedidos.map((p) => ({
          ...p,
          itens: itens.filter((i) => i.pedidoId === p.id),
        }))}
        filiais={acessiveis.map((fil) => ({ id: fil.id, nome: fil.nome }))}
        filialFiltro={filialFiltro}
        podeAtualizar={podeAtualizar}
        podeConfigurar={podeConfigurar}
        lojas={lojas.map((l) => ({
          id: l.id,
          slug: l.config?.slug ?? null,
          ativo: l.config?.ativo === true,
          pausado: l.config?.pausado === true,
        }))}
      />
    </main>
  );
}
