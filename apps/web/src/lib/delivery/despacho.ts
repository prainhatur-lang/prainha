// Despacho do nosso delivery com boy (dono 22/11/2026).
//
// - Boy nosso ou de terceiro, cadastro único por telefone (vale pras 3 casas).
//   Na 1ª vez ele mesmo preenche no link: nome, CPF, chave Pix e confirma o
//   telefone com um código que chega no WhatsApp.
// - Despachar: gera o link do boy (/delivery/entrega/<token>) e o código de
//   4 dígitos do cliente (vai no WhatsApp do cliente e na página do pedido).
// - Na porta: boy digita o código do cliente → pedido concluído → Pix do
//   frete CHEIO (pela distância, mesmo com frete grátis) na chave que ELE
//   informou, pelo Inter da casa, na hora, sem aprovação de ninguém.
//   EXCEÇÃO à regra "Pix só na chave autorizada": vale só pra esse Pix.
// - Sem o código do cliente, não sai Pix (nada de liberação manual).

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { enviarAtualizacaoReserva } from '@/lib/whatsapp-otp';
import { calcularFrete } from '@/lib/delivery/frete';
import { normalizarConfig } from '@/lib/delivery/config';
import {
  incluirPagamentoPixInter,
  InterPixRecusado,
  resolverCredenciaisInterPagamentos,
} from '@/lib/inter';
import { cpfValido, tipoChavePix } from '@/lib/pix-titular';
import { baixarContasDoPix, lerSaldoParaPix, sincronizarPixAbertos, type SaldoParaPix } from '@/lib/pix-pagamento';
import { baseUrlApp } from '@/lib/pix-comprovante-whatsapp';

export const MAX_TENTATIVAS_CODIGO = 5;
const OTP_VALIDADE_MS = 10 * 60_000;
const MAX_TENTATIVAS_OTP = 5;

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Só dígitos, com 55 quando vier com DDD (10/11 dígitos). */
export function normalizarTelefone(t: string): string | null {
  const d = String(t ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function linkDoBoy(token: string): string {
  return `${baseUrlApp()}/delivery/entrega/${token}`;
}

export function boyCadastroCompleto(e: {
  nome: string | null;
  cpf: string | null;
  pixChave: string | null;
  telefoneVerificadoEm: Date | null;
}): boolean {
  return !!(e.nome && e.cpf && e.pixChave && e.telefoneVerificadoEm);
}

/** Frete cheio do pedido: o gravado; pedido antigo recalcula pela distância. */
export async function freteCheioDoPedido(p: typeof schema.deliveryPedido.$inferSelect): Promise<number> {
  if (p.taxaEntregaCheia != null) return Number(p.taxaEntregaCheia);
  const [f] = await db
    .select({ config: schema.filial.deliveryConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, p.filialId))
    .limit(1);
  if (f?.config) {
    const r = calcularFrete({
      config: normalizarConfig(f.config),
      distanciaKm: p.distanciaKm != null ? Number(p.distanciaKm) : null,
      subtotalCentavos: Math.round(Number(p.subtotal) * 100),
      primeiraCompra: false,
      cupomFreteGratis: false,
    });
    if (r.ok && r.taxaCheiaCentavos > 0) return r.taxaCheiaCentavos / 100;
  }
  return Number(p.taxaEntrega);
}

function enderecoTexto(e: schema.DeliveryEnderecoCliente | null | undefined): string {
  if (!e) return '';
  return [
    [e.rua, e.numero].filter(Boolean).join(', '),
    e.complemento,
    e.bairro,
    e.referencia ? `Ref.: ${e.referencia}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// ───────────────────────── despachar ─────────────────────────

export type ResultadoDespacho =
  | {
      ok: true;
      despachoId: string;
      linkBoy: string;
      boyNovo: boolean;
      valor: number;
      enviadoBoy: boolean;
      enviadoCliente: boolean;
      waBoy: string;
      waCliente: string;
    }
  | { ok: false; erro: string; status?: number };

const STATUS_DESPACHAVEL = ['pago', 'em_preparo', 'pronto', 'saiu_entrega', 'chegou'];

export async function despacharPedido(params: {
  pedidoId: string;
  telefoneBoy: string;
  usuarioId: string;
}): Promise<ResultadoDespacho> {
  const tel = normalizarTelefone(params.telefoneBoy);
  if (!tel) return { ok: false, erro: 'Telefone do boy inválido (DDD + número).' };

  const [p] = await db
    .select()
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.id, params.pedidoId))
    .limit(1);
  if (!p) return { ok: false, erro: 'pedido não encontrado', status: 404 };
  if (p.tipo !== 'entrega') return { ok: false, erro: 'Pedido de retirada não tem despacho.' };
  if (!STATUS_DESPACHAVEL.includes(p.status)) {
    return { ok: false, erro: `Pedido está "${p.status}" — não dá pra despachar.` };
  }

  // Cadastro do boy (cria vazio; ele completa no link).
  await db
    .insert(schema.deliveryEntregador)
    .values({ telefone: tel })
    .onConflictDoNothing({ target: schema.deliveryEntregador.telefone });
  const [boy] = await db
    .select()
    .from(schema.deliveryEntregador)
    .where(eq(schema.deliveryEntregador.telefone, tel))
    .limit(1);
  if (!boy) return { ok: false, erro: 'não consegui gravar o boy' };

  const valor = await freteCheioDoPedido(p);
  if (!(valor > 0)) return { ok: false, erro: 'Frete do pedido zerado — não há o que pagar ao boy.' };

  const [existente] = await db
    .select()
    .from(schema.deliveryDespacho)
    .where(eq(schema.deliveryDespacho.pedidoId, p.id))
    .limit(1);
  if (existente?.entregueEm) return { ok: false, erro: 'Esse pedido já foi entregue (código conferido).' };

  let despacho: typeof schema.deliveryDespacho.$inferSelect;
  if (existente) {
    // Trocou de boy ou reenviou: mesmo código do cliente, link novo se mudou o boy.
    const trocou = existente.entregadorId !== boy.id;
    const [d] = await db
      .update(schema.deliveryDespacho)
      .set({
        entregadorId: boy.id,
        token: trocou ? randomBytes(18).toString('base64url') : existente.token,
        valor: valor.toFixed(2),
        usuarioId: params.usuarioId,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.deliveryDespacho.id, existente.id))
      .returning();
    despacho = d!;
  } else {
    const [d] = await db
      .insert(schema.deliveryDespacho)
      .values({
        pedidoId: p.id,
        filialId: p.filialId,
        entregadorId: boy.id,
        token: randomBytes(18).toString('base64url'),
        valor: valor.toFixed(2),
        codigoCliente: String(randomInt(0, 10000)).padStart(4, '0'),
        usuarioId: params.usuarioId,
      })
      .returning();
    despacho = d!;
  }

  if (p.status !== 'saiu_entrega' && p.status !== 'chegou') {
    await db
      .update(schema.deliveryPedido)
      .set({ status: 'saiu_entrega', atualizadoEm: new Date() })
      .where(eq(schema.deliveryPedido.id, p.id));
  }

  const link = linkDoBoy(despacho.token);
  const boyNovo = !boyCadastroCompleto(boy);
  const end = enderecoTexto(p.endereco as schema.DeliveryEnderecoCliente | null);
  const msgBoy = boyNovo
    ? `Entrega do pedido #${p.numero} (${brl(valor)}). Primeira vez: abra o link, faça seu cadastro (CPF, chave Pix) e, na entrega, peça o código ao cliente: ${link}`
    : `Entrega do pedido #${p.numero} pra ${p.clienteNome.split(' ')[0]} — ${end}. Você recebe ${brl(valor)} no Pix quando digitar o código do cliente: ${link}`;
  const primeiro = p.clienteNome.split(' ')[0] || p.clienteNome;
  const msgCliente = `Pedido #${p.numero} saiu pra entrega! 🛵 Seu código de entrega é ${despacho.codigoCliente} — passe pro entregador só quando receber o pedido.`;

  const [enviadoBoy, enviadoCliente] = await Promise.all([
    enviarAtualizacaoReserva(tel, { nome: boy.nome?.split(' ')[0] || 'entregador', mensagem: msgBoy }, p.filialId).catch(() => false),
    enviarAtualizacaoReserva(p.clienteTelefone, { nome: primeiro, mensagem: msgCliente }, p.filialId).catch(() => false),
  ]);

  return {
    ok: true,
    despachoId: despacho.id,
    linkBoy: link,
    boyNovo,
    valor,
    enviadoBoy,
    enviadoCliente,
    waBoy: `https://wa.me/${tel}?text=${encodeURIComponent(msgBoy)}`,
    waCliente: `https://wa.me/${p.clienteTelefone}?text=${encodeURIComponent(msgCliente)}`,
  };
}

// ───────────────────────── página do boy ─────────────────────────

export async function despachoPorToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [r] = await db
    .select({
      despacho: schema.deliveryDespacho,
      boy: schema.deliveryEntregador,
      pedido: schema.deliveryPedido,
      filialNome: schema.filial.nome,
    })
    .from(schema.deliveryDespacho)
    .innerJoin(schema.deliveryEntregador, eq(schema.deliveryEntregador.id, schema.deliveryDespacho.entregadorId))
    .innerJoin(schema.deliveryPedido, eq(schema.deliveryPedido.id, schema.deliveryDespacho.pedidoId))
    .innerJoin(schema.filial, eq(schema.filial.id, schema.deliveryDespacho.filialId))
    .where(eq(schema.deliveryDespacho.token, token))
    .limit(1);
  return r ?? null;
}

/** O que a página do boy pode ver (sem código do cliente, sem hash). */
export async function visaoDoBoy(token: string) {
  const r = await despachoPorToken(token);
  if (!r) return null;
  const { despacho: d, boy, pedido: p } = r;
  return {
    casa: r.filialNome,
    numero: p.numero,
    status: p.status,
    clienteNome: p.clienteNome,
    clienteTelefone: p.clienteTelefone,
    endereco: enderecoTexto(p.endereco as schema.DeliveryEnderecoCliente | null),
    observacao: p.observacao,
    valor: Number(d.valor),
    entregue: !!d.entregueEm,
    tentativasRestantes: Math.max(0, MAX_TENTATIVAS_CODIGO - d.tentativas),
    pixStatus: d.pixStatus,
    pixErro: d.pixErro,
    boy: {
      nome: boy.nome,
      cpf: boy.cpf ? `***.${boy.cpf.slice(3, 6)}.***-${boy.cpf.slice(9)}` : null,
      pixChave: boy.pixChave,
      telefoneFinal: boy.telefone.slice(-4),
      cadastroCompleto: boyCadastroCompleto(boy),
      telefoneVerificado: !!boy.telefoneVerificadoEm,
    },
  };
}

/** Manda o código de confirmação do telefone pro WhatsApp do boy. */
export async function enviarCodigoTelefone(token: string): Promise<{ ok: boolean; erro?: string }> {
  const r = await despachoPorToken(token);
  if (!r) return { ok: false, erro: 'link inválido' };
  const { boy } = r;
  if (boy.otpExpira && boy.otpExpira.getTime() - OTP_VALIDADE_MS + 45_000 > Date.now()) {
    return { ok: false, erro: 'Já mandei um código agora há pouco — espere um minuto.' };
  }
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db
    .update(schema.deliveryEntregador)
    .set({ otpHash: hash(`${boy.id}:${codigo}`), otpExpira: new Date(Date.now() + OTP_VALIDADE_MS), otpTentativas: 0, atualizadoEm: new Date() })
    .where(eq(schema.deliveryEntregador.id, boy.id));
  const ok = await enviarAtualizacaoReserva(
    boy.telefone,
    { nome: 'entregador', mensagem: `Seu código de cadastro de entregador ${r.filialNome}: ${codigo}. Vale 10 minutos.` },
    r.despacho.filialId,
  ).catch(() => false);
  return ok ? { ok: true } : { ok: false, erro: 'Não consegui mandar o WhatsApp agora. Tente de novo.' };
}

/** Cadastro do boy (1ª vez): nome, CPF, chave Pix + código do telefone. */
export async function salvarCadastroBoy(
  token: string,
  dados: { nome: string; cpf: string; pixChave: string; codigo?: string },
): Promise<{ ok: boolean; erro?: string }> {
  const r = await despachoPorToken(token);
  if (!r) return { ok: false, erro: 'link inválido' };
  const { boy } = r;
  if (r.despacho.entregueEm) return { ok: false, erro: 'Essa entrega já foi finalizada.' };
  const nome = String(dados.nome ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const cpf = String(dados.cpf ?? '').replace(/\D/g, '');
  const pixChave = String(dados.pixChave ?? '').trim().slice(0, 140);
  if (nome.split(' ').length < 2) return { ok: false, erro: 'Informe nome e sobrenome.' };
  if (!cpfValido(cpf)) return { ok: false, erro: 'CPF inválido.' };
  if (!pixChave || tipoChavePix(pixChave) === 'DESCONHECIDA') {
    return { ok: false, erro: 'Chave Pix não reconhecida (CPF, CNPJ, e-mail, celular com +55 ou chave aleatória).' };
  }

  let verificado = boy.telefoneVerificadoEm;
  if (!verificado) {
    const codigo = String(dados.codigo ?? '').replace(/\D/g, '');
    if (!boy.otpHash || !boy.otpExpira) return { ok: false, erro: 'Peça o código do WhatsApp primeiro.' };
    if (boy.otpTentativas >= MAX_TENTATIVAS_OTP) return { ok: false, erro: 'Muitas tentativas. Peça um código novo.' };
    if (boy.otpExpira.getTime() < Date.now()) return { ok: false, erro: 'Código vencido. Peça um novo.' };
    if (!iguais(hash(`${boy.id}:${codigo}`), boy.otpHash)) {
      await db
        .update(schema.deliveryEntregador)
        .set({ otpTentativas: sql`${schema.deliveryEntregador.otpTentativas} + 1` })
        .where(eq(schema.deliveryEntregador.id, boy.id));
      return { ok: false, erro: 'Código do WhatsApp não confere.' };
    }
    verificado = new Date();
  }
  await db
    .update(schema.deliveryEntregador)
    .set({ nome, cpf, pixChave, telefoneVerificadoEm: verificado, otpHash: null, otpExpira: null, otpTentativas: 0, atualizadoEm: new Date() })
    .where(eq(schema.deliveryEntregador.id, boy.id));
  return { ok: true };
}

// ───────────────────────── código do cliente + Pix ─────────────────────────

export type ResultadoEntrega = { ok: boolean; erro?: string; pix?: string; mensagem?: string };

/** Boy digitou o código do cliente. Bateu → conclui o pedido e manda o Pix. */
export async function confirmarEntrega(token: string, codigoDigitado: string): Promise<ResultadoEntrega> {
  const r = await despachoPorToken(token);
  if (!r) return { ok: false, erro: 'link inválido' };
  const { despacho: d, boy, pedido: p } = r;
  if (!boyCadastroCompleto(boy)) return { ok: false, erro: 'Complete seu cadastro antes.' };
  if (d.entregueEm) {
    // Já entregue: só tenta o Pix de novo se ficou sem sair (recusa/erro).
    return pagarBoy(d.id);
  }
  if (p.status === 'cancelado') return { ok: false, erro: 'Esse pedido foi cancelado pela loja.' };
  if (d.tentativas >= MAX_TENTATIVAS_CODIGO) {
    return { ok: false, erro: 'Código errado muitas vezes. Ligue pra loja pra gerarem um código novo pro cliente.' };
  }
  const codigo = String(codigoDigitado ?? '').replace(/\D/g, '');
  if (!iguais(codigo.padStart(4, '0').slice(-6), d.codigoCliente)) {
    const [u] = await db
      .update(schema.deliveryDespacho)
      .set({ tentativas: sql`${schema.deliveryDespacho.tentativas} + 1`, atualizadoEm: new Date() })
      .where(eq(schema.deliveryDespacho.id, d.id))
      .returning({ t: schema.deliveryDespacho.tentativas });
    const resta = Math.max(0, MAX_TENTATIVAS_CODIGO - (u?.t ?? d.tentativas + 1));
    return { ok: false, erro: `Código não confere. ${resta > 0 ? `Restam ${resta} tentativa(s).` : 'Acabaram as tentativas — ligue pra loja.'}` };
  }

  // Marca entregue uma vez só (corrida de dois cliques).
  const marcou = await db
    .update(schema.deliveryDespacho)
    .set({ entregueEm: new Date(), atualizadoEm: new Date() })
    .where(and(eq(schema.deliveryDespacho.id, d.id), sql`${schema.deliveryDespacho.entregueEm} IS NULL`))
    .returning({ id: schema.deliveryDespacho.id });
  if (marcou.length > 0) {
    await db
      .update(schema.deliveryPedido)
      .set({ status: 'concluido', atualizadoEm: new Date() })
      .where(and(eq(schema.deliveryPedido.id, p.id), sql`${schema.deliveryPedido.status} <> 'cancelado'`));
    const primeiro = p.clienteNome.split(' ')[0] || p.clienteNome;
    void enviarAtualizacaoReserva(
      p.clienteTelefone,
      { nome: primeiro, mensagem: `Pedido #${p.numero} entregue. Obrigado pela preferência! 💛` },
      p.filialId,
    ).catch(() => false);
  }
  return pagarBoy(d.id);
}

/** Gera um código novo pro cliente (loja, quando o boy errou demais). */
export async function novoCodigoCliente(despachoId: string): Promise<{ ok: boolean; erro?: string; waCliente?: string; enviado?: boolean }> {
  const [r] = await db
    .select({ d: schema.deliveryDespacho, p: schema.deliveryPedido })
    .from(schema.deliveryDespacho)
    .innerJoin(schema.deliveryPedido, eq(schema.deliveryPedido.id, schema.deliveryDespacho.pedidoId))
    .where(eq(schema.deliveryDespacho.id, despachoId))
    .limit(1);
  if (!r) return { ok: false, erro: 'despacho não encontrado' };
  if (r.d.entregueEm) return { ok: false, erro: 'já entregue' };
  const codigo = String(randomInt(0, 10000)).padStart(4, '0');
  await db
    .update(schema.deliveryDespacho)
    .set({ codigoCliente: codigo, tentativas: 0, atualizadoEm: new Date() })
    .where(eq(schema.deliveryDespacho.id, despachoId));
  const msg = `Pedido #${r.p.numero}: seu novo código de entrega é ${codigo} — passe pro entregador só quando receber o pedido.`;
  const primeiro = r.p.clienteNome.split(' ')[0] || r.p.clienteNome;
  const enviado = await enviarAtualizacaoReserva(r.p.clienteTelefone, { nome: primeiro, mensagem: msg }, r.p.filialId).catch(() => false);
  return { ok: true, enviado, waCliente: `https://wa.me/${r.p.clienteTelefone}?text=${encodeURIComponent(msg)}` };
}

/**
 * Pix do boy pelo Inter da casa. Só roda com o despacho ENTREGUE (código do
 * cliente conferido). Mesmo padrão do Pagar por Pix: trava por casa, saldo
 * livre, idempotência pelo id do pix_pagamento. Repetir é seguro: se já tem
 * Pix sem desfecho ou pago, não manda outro.
 */
export async function pagarBoy(despachoId: string): Promise<ResultadoEntrega> {
  const [r] = await db
    .select({ d: schema.deliveryDespacho, boy: schema.deliveryEntregador, p: schema.deliveryPedido })
    .from(schema.deliveryDespacho)
    .innerJoin(schema.deliveryEntregador, eq(schema.deliveryEntregador.id, schema.deliveryDespacho.entregadorId))
    .innerJoin(schema.deliveryPedido, eq(schema.deliveryPedido.id, schema.deliveryDespacho.pedidoId))
    .where(eq(schema.deliveryDespacho.id, despachoId))
    .limit(1);
  if (!r) return { ok: false, erro: 'despacho não encontrado' };
  const { d, boy, p } = r;
  if (!d.entregueEm) return { ok: false, erro: 'Sem o código do cliente não sai Pix.' };
  if (!boy.pixChave) return { ok: false, erro: 'Boy sem chave Pix.' };
  const valor = Number(d.valor);
  const filialId = d.filialId;

  const marcarDespacho = (campos: Partial<typeof schema.deliveryDespacho.$inferInsert>) =>
    db.update(schema.deliveryDespacho).set({ ...campos, atualizadoEm: new Date() }).where(eq(schema.deliveryDespacho.id, d.id));

  // Já tem Pix deste despacho?
  if (d.pixPagamentoId) {
    const [pix] = await db
      .select({ status: schema.pixPagamento.status })
      .from(schema.pixPagamento)
      .where(eq(schema.pixPagamento.id, d.pixPagamentoId))
      .limit(1);
    if (pix && pix.status !== 'ERRO') {
      if (pix.status !== d.pixStatus) await marcarDespacho({ pixStatus: pix.status });
      return pix.status === 'PAGO'
        ? { ok: true, pix: 'PAGO', mensagem: `Entrega confirmada. Pix de ${brl(valor)} já enviado pra sua chave.` }
        : { ok: true, pix: pix.status, mensagem: `Entrega confirmada. O Pix de ${brl(valor)} está em processamento no banco.` };
    }
  }

  const cred = resolverCredenciaisInterPagamentos(filialId);
  if (!cred) {
    await marcarDespacho({ pixStatus: 'ERRO', pixErro: 'casa sem integração de pagamentos do Inter' });
    return { ok: true, pix: 'ERRO', mensagem: 'Entrega confirmada. O Pix automático não está ligado nesta casa — a loja vai te pagar.' };
  }
  await sincronizarPixAbertos(filialId, cred).catch(() => null);

  const descricao = `Entrega pedido #${p.numero} - ${boy.nome ?? ''}`.slice(0, 140);
  const res = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'pix_pagamento:' + filialId}))`);
    // dentro da trava: outro clique pode ter criado o Pix
    const [atual] = await tx
      .select({ pixId: schema.deliveryDespacho.pixPagamentoId })
      .from(schema.deliveryDespacho)
      .where(eq(schema.deliveryDespacho.id, d.id))
      .limit(1);
    if (atual?.pixId && atual.pixId !== d.pixPagamentoId) return { tipo: 'ja' as const };
    let saldo: SaldoParaPix;
    try {
      saldo = await lerSaldoParaPix(filialId, cred, tx);
    } catch (e) {
      return { tipo: 'saldo_erro' as const, erro: e instanceof Error ? e.message : String(e) };
    }
    if (Math.round(saldo.livre * 100) < Math.round(valor * 100)) return { tipo: 'sem_saldo' as const };
    const [linha] = await tx
      .insert(schema.pixPagamento)
      .values({
        filialId,
        fornecedorId: null,
        favorecido: boy.nome,
        contaIds: [],
        chave: boy.pixChave!,
        valor: valor.toFixed(2),
        descricao,
        status: 'ENVIANDO',
        usuarioId: null,
        usuarioEmail: `delivery-boy:${boy.telefone}`,
      })
      .returning({ id: schema.pixPagamento.id });
    await tx
      .update(schema.deliveryDespacho)
      .set({ pixPagamentoId: linha!.id, pixStatus: 'ENVIANDO', pixErro: null, atualizadoEm: new Date() })
      .where(eq(schema.deliveryDespacho.id, d.id));
    return { tipo: 'criado' as const, id: linha!.id };
  });

  if (res.tipo === 'ja') return pagarBoy(d.id);
  if (res.tipo === 'saldo_erro' || res.tipo === 'sem_saldo') {
    const motivo = res.tipo === 'sem_saldo' ? 'sem saldo livre no Inter' : `saldo não lido: ${res.erro.slice(0, 200)}`;
    await marcarDespacho({ pixStatus: 'ERRO', pixErro: motivo });
    console.error('[delivery-boy] Pix NÃO enviado', { despacho: d.id, motivo });
    return {
      ok: true,
      pix: 'ERRO',
      mensagem: `Entrega confirmada. O Pix não saiu agora (${res.tipo === 'sem_saldo' ? 'banco sem saldo' : 'banco não respondeu'}) — nenhum dinheiro saiu. Toque em "Tentar o Pix de novo" daqui a pouco.`,
    };
  }

  const pixId = res.id;
  const atualizarPix = (campos: Partial<typeof schema.pixPagamento.$inferInsert>) =>
    db.update(schema.pixPagamento).set({ ...campos, atualizadoEm: new Date() }).where(eq(schema.pixPagamento.id, pixId));

  let resp;
  try {
    resp = await incluirPagamentoPixInter(cred, { valor, chave: boy.pixChave, descricao, idempotencia: pixId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof InterPixRecusado) {
      await atualizarPix({ status: 'ERRO', erro: msg.slice(0, 1000), retorno: (e.detalhe ?? null) as object | null });
      await marcarDespacho({ pixStatus: 'ERRO', pixErro: msg.slice(0, 500) });
      return {
        ok: true,
        pix: 'ERRO',
        mensagem: `Entrega confirmada. O banco recusou o Pix pra chave "${boy.pixChave}" — nenhum dinheiro saiu. Confira sua chave com a loja.`,
      };
    }
    await atualizarPix({ erro: msg.slice(0, 1000) });
    await marcarDespacho({ pixStatus: 'PENDENTE', pixErro: 'banco não respondeu' });
    return { ok: true, pix: 'PENDENTE', mensagem: 'Entrega confirmada. O banco não respondeu na hora; a loja confere se o Pix saiu.' };
  }

  const tipo = String(resp.tipoRetorno ?? '').toUpperCase();
  const status = tipo === 'APROVACAO' ? 'APROVACAO' : tipo === 'AGENDADO' ? 'AGENDADO' : 'ENVIANDO';
  await atualizarPix({
    statusInter: tipo || null,
    codigoSolicitacao: resp.codigoSolicitacao ?? null,
    endToEndId: resp.endToEndId ?? null,
    retorno: resp as object,
    status,
  });
  if (tipo === 'PROCESSADO') {
    await baixarContasDoPix(pixId, resp.dataPagamento ?? null);
    await marcarDespacho({ pixStatus: 'PAGO', pixErro: null });
    void enviarAtualizacaoReserva(
      boy.telefone,
      { nome: boy.nome?.split(' ')[0] || 'entregador', mensagem: `Pix de ${brl(valor)} enviado pra sua chave ${boy.pixChave} — entrega do pedido #${p.numero}. Valeu! 🛵` },
      filialId,
    ).catch(() => false);
    return { ok: true, pix: 'PAGO', mensagem: `Entrega confirmada! Pix de ${brl(valor)} enviado pra sua chave.` };
  }
  await marcarDespacho({ pixStatus: status });
  return {
    ok: true,
    pix: status,
    mensagem:
      status === 'APROVACAO'
        ? `Entrega confirmada. O Pix de ${brl(valor)} ficou esperando aprovação no banco da loja.`
        : `Entrega confirmada. O Pix de ${brl(valor)} está em processamento no banco.`,
  };
}
