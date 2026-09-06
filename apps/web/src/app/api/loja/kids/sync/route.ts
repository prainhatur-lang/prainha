// Espaço Kids — a loja puxa (polling) o que aconteceu na nuvem desde o cursor:
// zaps confirmados pelo QR e respostas do responsável.
//
// GET ?f&e&s&desde=<ISO>
//   -> { ok, agora, confirmados:[{codigo, telefone, confirmado_em}],
//        mensagens:[{codigo, texto, wa_message_id, criado_em}] }
//
// `agora` volta 5 s atrasado de propósito: a loja usa como próximo `desde`, e
// uma linha gravada no meio da consulta reaparece no ciclo seguinte em vez de
// sumir (a loja é idempotente: confirmação é UPDATE sem efeito, mensagem
// dedupe por wa_message_id). Janela máxima de 48 h.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, gte } from 'drizzle-orm';
import { validaLojaKids } from '@/lib/kids';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const filial = await validaLojaKids(sp);
  if (!filial) return NextResponse.json({ ok: false, erro: 'assinatura inválida ou expirada' }, { status: 403 });

  const agora = new Date(Date.now() - 5000);
  const minimo = new Date(Date.now() - 48 * 3600 * 1000);
  const pedido = new Date(sp.get('desde') || '');
  const desde = Number.isFinite(pedido.getTime()) && pedido > minimo ? pedido : minimo;

  const confirmados = await db
    .select({
      codigo: schema.kidsCheckin.codigo,
      telefone: schema.kidsCheckin.telefoneConfirmado,
      confirmado_em: schema.kidsCheckin.confirmadoEm,
    })
    .from(schema.kidsCheckin)
    .where(and(eq(schema.kidsCheckin.filialId, filial.id), gte(schema.kidsCheckin.confirmadoEm, desde)))
    .orderBy(schema.kidsCheckin.confirmadoEm)
    .limit(500);

  const mensagens = await db
    .select({
      codigo: schema.kidsCheckin.codigo,
      texto: schema.kidsMensagem.texto,
      wa_message_id: schema.kidsMensagem.waMessageId,
      criado_em: schema.kidsMensagem.criadoEm,
    })
    .from(schema.kidsMensagem)
    .innerJoin(schema.kidsCheckin, eq(schema.kidsCheckin.id, schema.kidsMensagem.checkinId))
    .where(
      and(
        eq(schema.kidsCheckin.filialId, filial.id),
        eq(schema.kidsMensagem.direcao, 'entrada'),
        gte(schema.kidsMensagem.criadoEm, desde),
      ),
    )
    .orderBy(schema.kidsMensagem.criadoEm)
    .limit(500);

  return NextResponse.json({ ok: true, agora: agora.toISOString(), confirmados, mensagens });
}
