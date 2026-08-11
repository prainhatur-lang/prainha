// Montagem e ciclo de vida do pedido de delivery.
//
// O checkout NUNCA é confiado: preço vem do delivery_item no banco, frete é
// recalculado (geocodificando de novo), cupom é revalidado e o agendamento é
// conferido contra a agenda do servidor. O total cobrado na Cielo é o daqui.

import { randomBytes } from 'node:crypto';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import type { DeliveryConfig, DeliveryEnderecoCliente } from '@concilia/db/schema';
import { enviarAtualizacaoReserva } from '@/lib/whatsapp-otp';
import { agendamentoValido } from './config';
import {
  calcularFrete,
  ehPrimeiraCompra,
  geocodificarEndereco,
  haversineKm,
} from './frete';
import { validarCupom } from './cupom';

/** Minutos até um pedido sem pagamento expirar sozinho. */
const EXPIRA_PENDENTE_MIN = 40;

export function normTelefone(v: string | null | undefined): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) d = '55' + d;
  return d.slice(0, 15);
}

export function centavos(valorNumeric: string | number | null | undefined): number {
  return Math.round(Number(valorNumeric ?? 0) * 100);
}

export function reais(cent: number): string {
  return (cent / 100).toFixed(2);
}

export interface NovoPedidoInput {
  clienteNome: string;
  clienteTelefone: string;
  clienteCpf?: string;
  tipo: 'entrega' | 'retirada';
  endereco?: DeliveryEnderecoCliente;
  agendamento: { asap?: boolean; data?: string; hora?: string };
  itens: Array<{ itemId: string; qtd: number; obs?: string }>;
  cupomCodigo?: string;
  observacao?: string;
  pagamentoMetodo: 'pix' | 'cartao';
}

export interface PedidoCriado {
  ok: boolean;
  erro?: string;
  pedido?: {
    id: string;
    numero: number;
    token: string;
    totalCentavos: number;
  };
}

const txt = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** Valida tudo e insere o pedido em `pendente_pagamento` (+ itens). */
export async function criarPedidoDelivery(params: {
  filialId: string;
  config: DeliveryConfig;
  input: NovoPedidoInput;
}): Promise<PedidoCriado> {
  const { filialId, config, input } = params;

  if (config.pausado) {
    return { ok: false, erro: 'A loja está pausada no momento — tente mais tarde.' };
  }

  const nome = txt(input.clienteNome, 120);
  const telefone = normTelefone(input.clienteTelefone);
  if (!nome || nome.length < 2) return { ok: false, erro: 'Informe seu nome.' };
  if (!telefone) return { ok: false, erro: 'Informe um WhatsApp válido com DDD.' };
  const cpf = (input.clienteCpf ?? '').replace(/\D/g, '') || null;
  if (cpf && cpf.length !== 11) return { ok: false, erro: 'CPF inválido.' };

  if (input.tipo !== 'entrega' && input.tipo !== 'retirada') {
    return { ok: false, erro: 'Escolha entrega ou retirada.' };
  }
  if (input.tipo === 'entrega' && config.entregaAtiva === false) {
    return { ok: false, erro: 'Estamos sem entrega no momento — escolha retirada.' };
  }
  if (input.tipo === 'retirada' && config.retiradaAtiva === false) {
    return { ok: false, erro: 'Estamos sem retirada no momento — escolha entrega.' };
  }

  if (input.pagamentoMetodo !== 'pix' && input.pagamentoMetodo !== 'cartao') {
    return { ok: false, erro: 'Escolha a forma de pagamento.' };
  }
  if (input.pagamentoMetodo === 'pix' && config.pixAtivo === false) {
    return { ok: false, erro: 'Pix indisponível — pague com cartão.' };
  }
  if (input.pagamentoMetodo === 'cartao' && config.cartaoAtivo === false) {
    return { ok: false, erro: 'Cartão indisponível — pague com Pix.' };
  }

  // Agendamento (calendário por dia e hora, validado no servidor)
  const ag = agendamentoValido(config, input.agendamento);
  if (!ag.ok) return { ok: false, erro: ag.erro };

  // Itens: preço SEMPRE do banco (delivery_item), nunca do payload
  if (!Array.isArray(input.itens) || input.itens.length === 0) {
    return { ok: false, erro: 'Seu carrinho está vazio.' };
  }
  if (input.itens.length > 50) return { ok: false, erro: 'Carrinho grande demais.' };
  const ids = [...new Set(input.itens.map((i) => i.itemId))];
  const doBanco = await db
    .select({
      id: schema.deliveryItem.id,
      nome: schema.deliveryItem.nome,
      preco: schema.deliveryItem.preco,
      ativo: schema.deliveryItem.ativo,
      esgotado: schema.deliveryItem.esgotado,
    })
    .from(schema.deliveryItem)
    .where(and(eq(schema.deliveryItem.filialId, filialId), inArray(schema.deliveryItem.id, ids)));
  const porId = new Map(doBanco.map((i) => [i.id, i]));

  let subtotalCentavos = 0;
  const itensPedido: Array<{
    itemId: string;
    nome: string;
    qtd: number;
    precoUnitCentavos: number;
    obs: string | null;
  }> = [];
  for (const i of input.itens) {
    const item = porId.get(i.itemId);
    if (!item || !item.ativo) {
      return { ok: false, erro: 'Um item do carrinho saiu do cardápio — revise o pedido.' };
    }
    if (item.esgotado) {
      return { ok: false, erro: `"${item.nome}" esgotou — remova do carrinho.` };
    }
    const qtd = Number.isInteger(i.qtd) && i.qtd > 0 ? Math.min(i.qtd, 99) : 1;
    const precoUnit = centavos(item.preco);
    subtotalCentavos += precoUnit * qtd;
    itensPedido.push({
      itemId: item.id,
      nome: item.nome,
      qtd,
      precoUnitCentavos: precoUnit,
      obs: txt(i.obs, 200),
    });
  }

  if (config.pedidoMinimo != null && config.pedidoMinimo > 0) {
    const minimo = Math.round(config.pedidoMinimo * 100);
    if (subtotalCentavos < minimo) {
      return {
        ok: false,
        erro: `Pedido mínimo de R$ ${config.pedidoMinimo.toFixed(2).replace('.', ',')} (sem contar a entrega).`,
      };
    }
  }

  // Cupom (revalidado agora; o uso conta quando o pedido for pago)
  let cupom: Awaited<ReturnType<typeof validarCupom>> | null = null;
  if (txt(input.cupomCodigo, 30)) {
    cupom = await validarCupom({
      filialId,
      codigo: input.cupomCodigo!,
      telefone,
      subtotalCentavos,
    });
    if (!cupom.ok) return { ok: false, erro: cupom.erro };
  }

  // Frete (só entrega): geocodifica e recalcula no servidor
  let taxaCentavos = 0;
  let distanciaKm: number | null = null;
  let freteGratisMotivo: string | null = null;
  let endereco: DeliveryEnderecoCliente | null = null;
  if (input.tipo === 'entrega') {
    const e = input.endereco ?? {};
    const cepDigitos = (e.cep ?? '').replace(/\D/g, '');
    endereco = {
      cep: cepDigitos || undefined,
      rua: txt(e.rua, 160) ?? undefined,
      numero: txt(e.numero, 20) ?? undefined,
      complemento: txt(e.complemento, 100) ?? undefined,
      bairro: txt(e.bairro, 80) ?? undefined,
      cidade: txt(e.cidade, 80) ?? config.endereco?.cidade,
      uf: txt(e.uf, 2) ?? config.endereco?.uf,
      referencia: txt(e.referencia, 160) ?? undefined,
    };
    if (!endereco.rua || !endereco.numero || !endereco.bairro) {
      return { ok: false, erro: 'Preencha o endereço de entrega (rua, número e bairro).' };
    }

    const lojaCoord =
      config.endereco?.lat != null && config.endereco?.lng != null
        ? { lat: config.endereco.lat, lng: config.endereco.lng }
        : null;
    if (lojaCoord) {
      const destino = await geocodificarEndereco(endereco);
      if (destino) {
        endereco.lat = destino.lat;
        endereco.lng = destino.lng;
        distanciaKm = Math.round(haversineKm(lojaCoord, destino) * 100) / 100;
      }
    }

    const frete = calcularFrete({
      config,
      distanciaKm,
      subtotalCentavos,
      primeiraCompra: config.gratisPrimeiraCompra
        ? await ehPrimeiraCompra(filialId, telefone)
        : false,
      cupomFreteGratis: cupom?.freteGratis ?? false,
    });
    if (!frete.ok) return { ok: false, erro: frete.erro };
    taxaCentavos = frete.taxaCentavos;
    freteGratisMotivo = frete.motivo;
  }

  const descontoCentavos = cupom?.descontoCentavos ?? 0;
  const totalCentavos = subtotalCentavos + taxaCentavos - descontoCentavos;
  if (totalCentavos < 100) {
    return { ok: false, erro: 'Total do pedido ficou abaixo de R$ 1,00.' };
  }

  const token = randomBytes(24).toString('hex');
  const [novo] = await db
    .insert(schema.deliveryPedido)
    .values({
      filialId,
      token,
      clienteNome: nome,
      clienteTelefone: telefone,
      clienteCpf: cpf,
      tipo: input.tipo,
      endereco,
      distanciaKm: distanciaKm != null ? String(distanciaKm) : null,
      agendadoData: ag.data,
      agendadoHora: ag.hora,
      asap: input.agendamento.asap === true,
      subtotal: reais(subtotalCentavos),
      taxaEntrega: reais(taxaCentavos),
      desconto: reais(descontoCentavos),
      total: reais(totalCentavos),
      freteGratisMotivo,
      cupomId: cupom?.cupomId ?? null,
      cupomCodigo: cupom?.codigo ?? null,
      status: 'pendente_pagamento',
      pagamentoMetodo: input.pagamentoMetodo,
      observacao: txt(input.observacao, 500),
    })
    .returning({
      id: schema.deliveryPedido.id,
      numero: schema.deliveryPedido.numero,
      token: schema.deliveryPedido.token,
    });

  await db.insert(schema.deliveryPedidoItem).values(
    itensPedido.map((i) => ({
      pedidoId: novo.id,
      itemId: i.itemId,
      nome: i.nome,
      qtd: i.qtd,
      precoUnit: reais(i.precoUnitCentavos),
      total: reais(i.precoUnitCentavos * i.qtd),
      obs: i.obs,
    })),
  );

  return {
    ok: true,
    pedido: { id: novo.id, numero: novo.numero, token: novo.token, totalCentavos },
  };
}

/** Marca o pedido como pago (idempotente): status, contador do cupom e aviso
 *  no WhatsApp do cliente (best-effort, template de utilidade genérico). */
export async function marcarDeliveryPedidoPago(
  pedidoId: string,
  appOrigin?: string,
): Promise<void> {
  const [p] = await db
    .select()
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.id, pedidoId))
    .limit(1);
  if (!p || p.status !== 'pendente_pagamento') return;

  await db
    .update(schema.deliveryPedido)
    .set({
      status: 'pago',
      pagamentoStatus: 'pago',
      pagoEm: new Date(),
      atualizadoEm: sql`now()`,
    })
    .where(
      and(
        eq(schema.deliveryPedido.id, pedidoId),
        eq(schema.deliveryPedido.status, 'pendente_pagamento'),
      ),
    );

  if (p.cupomId) {
    try {
      await db
        .update(schema.deliveryCupom)
        .set({ usados: sql`${schema.deliveryCupom.usados} + 1` })
        .where(eq(schema.deliveryCupom.id, p.cupomId));
    } catch (e) {
      console.error('delivery: erro incrementando uso do cupom:', (e as Error).message);
    }
  }

  if (appOrigin) {
    try {
      const link = `${appOrigin}/delivery/pedido/${p.token}`;
      await enviarAtualizacaoReserva(p.clienteTelefone, {
        nome: p.clienteNome.split(' ')[0],
        mensagem: `Recebemos seu pedido #${p.numero}! Acompanhe o preparo em ${link}`,
      });
    } catch (e) {
      console.error('delivery: erro enviando WhatsApp de confirmação:', (e as Error).message);
    }
  }
}

/** Cancela pedidos que ficaram sem pagamento (chamado de forma preguiçosa
 *  pelo painel e pela página de status — sem cron). */
export async function expirarPedidosPendentes(): Promise<void> {
  const limite = new Date(Date.now() - EXPIRA_PENDENTE_MIN * 60_000);
  try {
    await db
      .update(schema.deliveryPedido)
      .set({
        status: 'cancelado',
        canceladoMotivo: 'Pagamento não concluído a tempo',
        atualizadoEm: sql`now()`,
      })
      .where(
        and(
          eq(schema.deliveryPedido.status, 'pendente_pagamento'),
          lt(schema.deliveryPedido.criadoEm, limite),
        ),
      );
  } catch (e) {
    console.error('delivery: erro expirando pendentes:', (e as Error).message);
  }
}
