// O lançamento financeiro do pedido que veio da integração PRÓPRIA do canal.
//
// Até aqui a conta a receber nascia no ingest do Consumer. Com o iFood direto
// o pedido não passa mais pelo Consumer — se ninguém criar o lançamento, o
// repasse do iFood cai no banco sem contrapartida no sistema e o dinheiro some
// do controle. Quem chama é o vendas-local, com a mesma assinatura HMAC dos
// outros canais loja↔nuvem (escopo próprio, pra assinatura de uma rota não
// valer na outra).
//
//   POST { f, e, s, acao:'abrir'|'cancelar', pedido_ref, ... }
//
// NUNCA reabre nem sobrescreve o que o financeiro já baixou ou cancelou na
// mão: pedido reprocessado (evento repetido do iFood) não pode desfazer
// trabalho de gente.

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const f = String(b?.f || '');
  const e = Number(b?.e || 0);
  const pedidoRef = String(b?.pedido_ref || '');

  if (!f || !pedidoRef || !Number.isFinite(e)) return NextResponse.json({ error: 'parâmetros' }, { status: 400 });
  if (e * 1000 < Date.now()) return NextResponse.json({ error: 'expirado' }, { status: 403 });
  if (!confere([f, 'receber-canal', String(e)], String(b?.s || ''))) {
    return NextResponse.json({ error: 'assinatura' }, { status: 403 });
  }

  const acao = b?.acao === 'cancelar' ? 'cancelar' : 'abrir';
  const canal = String(b?.canal || 'ifood').slice(0, 20);

  if (acao === 'cancelar') {
    // só mexe no que ainda está aberto: baixado/cancelado na mão fica como está
    const r = await db
      .update(schema.contaReceberCanal)
      .set({ status: 'cancelado', observacao: String(b?.observacao || 'cancelado no canal').slice(0, 200), atualizadoEm: new Date() })
      .where(and(
        eq(schema.contaReceberCanal.filialId, f),
        eq(schema.contaReceberCanal.pedidoRef, pedidoRef),
        eq(schema.contaReceberCanal.status, 'aberto'),
      ))
      .returning({ id: schema.contaReceberCanal.id });
    return NextResponse.json({ ok: true, cancelados: r.length });
  }

  const valor = Number(b?.valor_bruto);
  if (!Number.isFinite(valor) || valor <= 0) return NextResponse.json({ error: 'valor_bruto inválido' }, { status: 400 });
  const dataPedido = b?.data_pedido ? new Date(String(b.data_pedido)) : new Date();

  const r = await db
    .insert(schema.contaReceberCanal)
    .values({
      filialId: f,
      canal,
      pedidoRef,
      // pedido do canal direto não tem código do Consumer; o número curto que
      // aparece pro cliente entra como referência de tela.
      pedidoNumero: Number(b?.display_id) || null,
      nomeCliente: String(b?.nome_cliente || '').slice(0, 200) || null,
      dataPedido: Number.isFinite(dataPedido.getTime()) ? dataPedido : new Date(),
      valorBruto: valor.toFixed(2),
    })
    // reprocessou o mesmo pedido: não recria e não mexe no que já existe
    .onConflictDoNothing()
    .returning({ id: schema.contaReceberCanal.id });

  return NextResponse.json({ ok: true, criado: r.length > 0 });
}
