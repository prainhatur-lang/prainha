// Vale-presente pré-pago (jantar de presente) — caso Thai, Tabuará 24/10/2026.
//
// A Nina/Otávio monta o menu com itens do cardápio (preço do SISTEMA, nunca
// inventado) + 10% de serviço, grava o vale, gera o Pix e devolve o link
// /presente/<token>. Pago, a mesma página vira o VOUCHER QUITADO com o código
// que o casal mostra na casa.

import { randomBytes } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { createPixPayment, queryPayment } from '@/lib/pagamento-online';
import { buscarItensCardapio } from '@/lib/atendimento/cardapio';

export const BASE_PRESENTE = 'https://app.prainhabar.com/presente/';

type Vale = typeof schema.valePresente.$inferSelect;
type ItemValePresente = Vale['itens'][number];

function dobrar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Código curto sem letras que confundem (0/O, 1/I/L). */
function gerarCodigo(): string {
  const alfa = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = randomBytes(5);
  let c = '';
  for (let i = 0; i < 5; i++) c += alfa[b[i]! % alfa.length];
  return `VP-${c}`;
}

export interface PedidoValePresente {
  filialId: string;
  filialNome: string;
  telefone: string;
  compradorNome: string;
  presenteados?: string;
  mensagem?: string;
  observacao?: string;
  data?: string;
  pessoas?: number;
  itens: Array<{ nome: string; qtd?: number }>;
  criadoPor?: string;
}

/** Acha o item do cardápio pelo nome (exato sem acento; senão o 1º ativo). */
async function casarItem(filialId: string, nome: string) {
  const lista = await buscarItensCardapio(filialId, nome, 8);
  const alvo = dobrar(nome);
  const ativos = lista.filter((i) => !i.pausado);
  return (
    ativos.find((i) => dobrar(i.nome) === alvo) ??
    ativos.find((i) => dobrar(`${i.nome} ${i.tamanho}`) === alvo) ??
    ativos[0] ??
    null
  );
}

async function gerarPix(v: Vale): Promise<Vale> {
  const amount = Math.round(Number(v.total) * 100);
  const pix = await createPixPayment({
    orderId: `VP-${v.numero}-${Math.floor(Math.random() * 100000)}`,
    amount,
    customerName: v.compradorNome,
    filialId: v.filialId,
  });
  const [atual] = await db
    .update(schema.valePresente)
    .set({
      pagamentoId: pix.paymentId,
      pagamentoQrcode: pix.qrCodeString,
      pagamentoQrcodeImg: pix.qrCodeBase64,
    })
    .where(eq(schema.valePresente.id, v.id))
    .returning();
  return atual ?? v;
}

/** Garante um Pix aguardando (idempotente). Devolve o vale atualizado. */
export async function garantirPixVale(v: Vale): Promise<Vale> {
  if (v.status !== 'aguardando') return v;
  if (v.pagamentoId && v.pagamentoQrcode) return v;
  return gerarPix(v);
}

/** Reconsulta o Pix na adquirente e marca pago quando confirmou. */
export async function atualizarPagamentoVale(v: Vale): Promise<Vale> {
  if (v.status !== 'aguardando' || !v.pagamentoId) return v;
  try {
    const r = await queryPayment(v.pagamentoId, v.filialId);
    if (r.status === 'pago') {
      const [atual] = await db
        .update(schema.valePresente)
        .set({ status: 'pago', pagoEm: new Date() })
        .where(eq(schema.valePresente.id, v.id))
        .returning();
      return atual ?? v;
    }
  } catch (e) {
    console.error('[vale-presente] consulta do Pix falhou:', e instanceof Error ? e.message : e);
  }
  return v;
}

export async function valePorToken(token: string): Promise<Vale | null> {
  if (!token || token.length < 20) return null;
  const [v] = await db.select().from(schema.valePresente).where(eq(schema.valePresente.token, token)).limit(1);
  return v ?? null;
}

/** Usado pelo webhook: pagamentoId → marca pago. true = era um vale. */
export async function processarWebhookVale(paymentId: string): Promise<boolean> {
  const [v] = await db
    .select()
    .from(schema.valePresente)
    .where(eq(schema.valePresente.pagamentoId, paymentId))
    .limit(1);
  if (!v) return false;
  await atualizarPagamentoVale(v);
  return true;
}

/** Texto que volta pra Nina (ferramenta montar_vale_presente). */
export async function criarValePresente(p: PedidoValePresente): Promise<string> {
  const pedidos = (p.itens ?? []).filter((i) => i?.nome?.trim());
  if (pedidos.length === 0) return 'ERRO: nenhum item informado. Monte o menu com consultar_cardapio e mande os nomes.';

  const itens: ItemValePresente[] = [];
  const naoAchados: string[] = [];
  for (const it of pedidos) {
    const achado = await casarItem(p.filialId, it.nome);
    if (!achado) {
      naoAchados.push(it.nome);
      continue;
    }
    const qtd = Math.max(1, Math.min(20, Math.round(Number(it.qtd) || 1)));
    itens.push({ nome: achado.nome, tamanho: achado.tamanho || undefined, qtd, preco: Number(achado.preco) });
  }
  if (naoAchados.length > 0) {
    return `ERRO: não achei no cardápio (ou está em falta hoje): ${naoAchados.join(', ')}. Consulte de novo com consultar_cardapio e use o nome exato. Nada foi criado.`;
  }

  const subtotal = Math.round(itens.reduce((s, i) => s + i.preco * i.qtd, 0) * 100) / 100;
  const servico = Math.round(subtotal * 10) / 100;
  const total = Math.round((subtotal + servico) * 100) / 100;
  if (total < 1) return 'ERRO: total inválido.';

  const data = p.data && /^\d{4}-\d{2}-\d{2}$/.test(p.data) ? p.data : null;
  const token = randomBytes(18).toString('base64url');

  let vale: Vale | null = null;
  for (let tentativa = 0; tentativa < 4 && !vale; tentativa++) {
    try {
      const [v] = await db
        .insert(schema.valePresente)
        .values({
          filialId: p.filialId,
          codigo: gerarCodigo(),
          token,
          compradorNome: (p.compradorNome || 'Cliente').slice(0, 200),
          compradorTelefone: p.telefone?.slice(0, 30) || null,
          presenteados: p.presenteados?.slice(0, 200) || null,
          mensagem: p.mensagem?.trim() || null,
          observacao: p.observacao?.trim() || null,
          dataUso: data,
          pessoas: Math.max(1, Math.min(20, Math.round(Number(p.pessoas) || 2))),
          itens,
          subtotal: subtotal.toFixed(2),
          servico: servico.toFixed(2),
          total: total.toFixed(2),
          criadoPor: p.criadoPor?.slice(0, 160) || 'Nina (WhatsApp)',
        })
        .returning();
      vale = v ?? null;
    } catch (e) {
      // código repetido (raríssimo) → tenta outro
      if (tentativa === 3) throw e;
    }
  }
  if (!vale) return 'ERRO: não consegui gravar o vale. Transfira pra equipe.';

  let pixTxt = '';
  try {
    vale = await gerarPix(vale);
    if (vale.pagamentoQrcode) pixTxt = `\nPix copia-e-cola: ${vale.pagamentoQrcode}`;
  } catch (e) {
    console.error('[vale-presente] Pix falhou na criação:', e instanceof Error ? e.message : e);
    pixTxt = '\n(o QR do Pix aparece ao abrir o link)';
  }

  const linhas = itens.map((i) => `- ${i.qtd}x ${i.nome}${i.tamanho ? ` (${i.tamanho})` : ''} — ${brl(i.preco * i.qtd)}`);
  return [
    `OK: vale-presente ${vale.codigo} criado (${p.filialNome}). AINDA NÃO PAGO.`,
    ...linhas,
    `Subtotal ${brl(subtotal)} + 10% serviço ${brl(servico)} = TOTAL ${brl(total)}`,
    `Link pra pagar (vira o voucher QUITADO depois do Pix): ${BASE_PRESENTE}${vale.token}`,
    pixTxt.trim(),
    'Mande ao cliente o resumo, o total e o link. Diga que, pago, o mesmo link vira o voucher pra encaminhar ao casal — eles mostram na casa.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ── Vale por VALOR (comprado no site) ──────────────────────────────────────

/** Casas que vendem vale no site: slug da URL → filial. */
export const CASAS_PRESENTE: Record<string, { filialId: string; nome: string; site: string }> = {
  bar: { filialId: '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9', nome: 'Prainha Bar', site: 'https://prainhabar.com' },
  tabuara: { filialId: 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7', nome: 'Tabuará', site: 'https://tabuara.com.br' },
  mar: { filialId: 'e899dae2-38bf-4f3f-9149-7effd059fab8', nome: 'Prainha Mar e Grill', site: 'https://prainhamar.com.br' },
};

export const VALOR_PRESENTE_MIN = 50;
export const VALOR_PRESENTE_MAX = 3000;

export interface PedidoValePorValor {
  casa: string;
  valor: number;
  compradorNome: string;
  compradorTelefone: string;
  presenteados: string;
  mensagem?: string;
}

/** Cria o vale de crédito livre + Pix. Devolve o token do link ou um erro. */
export async function criarValePorValor(p: PedidoValePorValor): Promise<{ token: string } | { erro: string }> {
  const casa = CASAS_PRESENTE[p.casa];
  if (!casa) return { erro: 'casa inválida' };
  const valor = Math.round(Number(p.valor) * 100) / 100;
  if (!Number.isFinite(valor) || valor < VALOR_PRESENTE_MIN || valor > VALOR_PRESENTE_MAX) {
    return { erro: `escolha um valor entre R$ ${VALOR_PRESENTE_MIN} e R$ ${VALOR_PRESENTE_MAX}` };
  }
  const nome = (p.compradorNome ?? '').trim();
  const presenteados = (p.presenteados ?? '').trim();
  const fone = (p.compradorTelefone ?? '').replace(/\D/g, '');
  if (nome.length < 2) return { erro: 'diga seu nome' };
  if (presenteados.length < 2) return { erro: 'diga pra quem é o presente' };
  if (fone.length < 10 || fone.length > 13) return { erro: 'WhatsApp inválido (com DDD)' };

  // Freio contra abuso: no máximo 5 vales sem pagar por telefone na última hora.
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.valePresente)
    .where(
      and(
        eq(schema.valePresente.compradorTelefone, fone),
        eq(schema.valePresente.status, 'aguardando'),
        gte(schema.valePresente.criadoEm, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    );
  if (n >= 5) return { erro: 'muitos vales em aberto pra este número — pague um dos que já gerou ou tente mais tarde' };

  const token = randomBytes(18).toString('base64url');
  let vale: Vale | null = null;
  for (let tentativa = 0; tentativa < 4 && !vale; tentativa++) {
    try {
      const [v] = await db
        .insert(schema.valePresente)
        .values({
          filialId: casa.filialId,
          codigo: gerarCodigo(),
          token,
          tipo: 'valor',
          compradorNome: nome.slice(0, 200),
          compradorTelefone: fone,
          presenteados: presenteados.slice(0, 200),
          mensagem: p.mensagem?.trim().slice(0, 600) || null,
          pessoas: 2,
          itens: [],
          subtotal: valor.toFixed(2),
          servico: '0.00',
          total: valor.toFixed(2),
          criadoPor: 'Site',
        })
        .returning();
      vale = v ?? null;
    } catch (e) {
      if (tentativa === 3) throw e;
    }
  }
  if (!vale) return { erro: 'não consegui gerar o vale agora — tente de novo' };
  try {
    await gerarPix(vale);
  } catch (e) {
    // A página do vale tenta de novo ao abrir.
    console.error('[vale-presente] Pix do site falhou:', e instanceof Error ? e.message : e);
  }
  return { token: vale.token };
}
