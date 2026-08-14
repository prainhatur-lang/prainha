// Conferência pós-evento: compara o cobrado no orçamento com o consumo real
// lançado no PDV (a equipe abre UMA comanda pro evento e lança tudo nela).
//  GET  — comandas fechadas no DIA do evento na filial (maior primeiro) +
//         estado atual da conferência.
//  POST — { pedidoIds } → soma o consumo, calcula média/pessoa e desvio,
//         grava em orcamento_evento.conferencia.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function carregarOrcamento(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [o] = await db
    .select()
    .from(schema.orcamentoEvento)
    .where(eq(schema.orcamentoEvento.id, id))
    .limit(1);
  if (!o) return null;
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => f.id === o.filialId)) return null;
  return o;
}

function totalCobrado(o: {
  pessoas: number;
  valorPessoa: string | null;
  taxaEspaco: string | null;
  taxaExclusividade: string | null;
}): number | null {
  if (o.valorPessoa == null) return null;
  return (
    o.pessoas * Number(o.valorPessoa) +
    Number(o.taxaEspaco ?? 0) +
    Number(o.taxaExclusividade ?? 0)
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('orcamento.read');
  if (error) return error;
  const { id } = await params;
  const o = await carregarOrcamento(user.id, id);
  if (!o) return NextResponse.json({ error: 'orçamento não encontrado' }, { status: 404 });

  // Comandas FECHADAS no dia do evento (data em BRT), maior valor primeiro —
  // a comanda do evento é tipicamente o maior ticket do dia.
  const comandas = await db
    .select({
      id: schema.pedido.id,
      numero: schema.pedido.numero,
      tag: schema.pedido.tag,
      nomeCliente: schema.pedido.nomeCliente,
      valorTotal: schema.pedido.valorTotal,
      quantidadePessoas: schema.pedido.quantidadePessoas,
      dataFechamento: schema.pedido.dataFechamento,
    })
    .from(schema.pedido)
    .where(
      and(
        eq(schema.pedido.filialId, o.filialId),
        sql`${schema.pedido.dataDelete} IS NULL`,
        sql`(${schema.pedido.dataFechamento} AT TIME ZONE 'America/Maceio')::date = ${String(o.dataEvento)}::date`,
      ),
    )
    .orderBy(sql`${schema.pedido.valorTotal} DESC NULLS LAST`)
    .limit(25);

  return NextResponse.json({
    cobrado: totalCobrado(o),
    pessoas: o.pessoas,
    dataEvento: String(o.dataEvento),
    conferencia: o.conferencia ?? null,
    comandas: comandas.map((c) => ({
      id: c.id,
      numero: c.numero,
      tag: c.tag,
      nomeCliente: c.nomeCliente,
      valorTotal: c.valorTotal == null ? 0 : Number(c.valorTotal),
      pessoas: c.quantidadePessoas,
      fechamento: c.dataFechamento ? c.dataFechamento.toISOString() : null,
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('orcamento.update');
  if (error) return error;
  const { id } = await params;
  const o = await carregarOrcamento(user.id, id);
  if (!o) return NextResponse.json({ error: 'orçamento não encontrado' }, { status: 404 });

  const b = await request.json().catch(() => null);
  const pedidoIds = Array.isArray(b?.pedidoIds)
    ? b.pedidoIds.filter((x: unknown) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20)
    : [];
  if (pedidoIds.length === 0) {
    return NextResponse.json({ error: 'selecione ao menos uma comanda' }, { status: 400 });
  }

  const pedidos = await db
    .select({ id: schema.pedido.id, valorTotal: schema.pedido.valorTotal })
    .from(schema.pedido)
    .where(and(eq(schema.pedido.filialId, o.filialId), inArray(schema.pedido.id, pedidoIds)));
  if (pedidos.length === 0) {
    return NextResponse.json({ error: 'comandas não encontradas' }, { status: 400 });
  }

  const consumido = pedidos.reduce((s, p) => s + (p.valorTotal == null ? 0 : Number(p.valorTotal)), 0);
  const cobrado = totalCobrado(o);
  const mediaPessoa = o.pessoas > 0 ? consumido / o.pessoas : 0;
  const desvioPct = cobrado != null && consumido > 0 ? ((cobrado - consumido) / consumido) * 100 : null;

  const conferencia = {
    pedidoIds: pedidos.map((p) => p.id),
    consumido: Math.round(consumido * 100) / 100,
    cobrado,
    mediaPessoa: Math.round(mediaPessoa * 100) / 100,
    desvioPct: desvioPct == null ? null : Math.round(desvioPct * 10) / 10,
    conferidoEm: new Date().toISOString(),
    conferidoPor: user.email ?? null,
  };

  await db
    .update(schema.orcamentoEvento)
    .set({ conferencia, atualizadoEm: sql`now()` })
    .where(eq(schema.orcamentoEvento.id, o.id));

  return NextResponse.json({ ok: true, conferencia });
}
