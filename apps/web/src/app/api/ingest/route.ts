// POST /api/ingest
// Endpoint chamado pelo agente local de cada filial para enviar
// pagamentos novos ou atualizados do Consumer (Firebird).
//
// Auth: Bearer <agente_token>
// Body: { pagamentos: PagamentoIngest[] }
// Resp: { recebidos, ultimoCodigoExterno }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { eq, sql as drizzleSql } from 'drizzle-orm';

// Forca rota dinamica — nao pre-renderizar, sempre executa em runtime.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PagamentoSchema = z.object({
  codigoExterno: z.number().int(),
  codigoPedidoExterno: z.number().int().nullable(),
  formaPagamento: z.string().nullable(),
  valor: z.number(),
  percentualTaxa: z.number().nullable(),
  dataPagamento: z.string().nullable(),
  dataCredito: z.string().nullable(),
  nsuTransacao: z.string().nullable(),
  numeroAutorizacaoCartao: z.string().nullable(),
  bandeiraMfe: z.string().nullable(),
  adquirenteMfe: z.string().nullable(),
  nroParcela: z.number().int().nullable(),
  codigoCredenciadoraCartao: z.number().int().nullable(),
  codigoContaCorrente: z.number().int().nullable(),
});

const BodySchema = z.object({
  pagamentos: z.array(PagamentoSchema).max(2000),
});

export async function POST(req: Request) {
  // 1. Autenticacao: Bearer <agente_token>
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = auth.slice(7);
  if (!token.startsWith('agt_')) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 });
  }

  // 2. Resolve filial
  const [filial] = await db
    .select({ id: schema.filial.id })
    .from(schema.filial)
    .where(eq(schema.filial.agenteToken, token))
    .limit(1);
  if (!filial) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 });
  }

  // 3. Valida body
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { pagamentos } = parsed.data;

  // 4. Atualiza ultimo ping (heartbeat) sempre, mesmo com batch vazio
  await db
    .update(schema.filial)
    .set({ ultimoPing: new Date() })
    .where(eq(schema.filial.id, filial.id));

  if (pagamentos.length === 0) {
    return NextResponse.json({ recebidos: 0, ultimoCodigoExterno: null });
  }

  // 5. Upsert em batch (idempotente via filial_id + codigo_externo)
  const rows = pagamentos.map((p) => ({
    filialId: filial.id,
    codigoExterno: p.codigoExterno,
    codigoPedidoExterno: p.codigoPedidoExterno,
    formaPagamento: p.formaPagamento,
    valor: String(p.valor),
    percentualTaxa: p.percentualTaxa !== null ? String(p.percentualTaxa) : null,
    dataPagamento: p.dataPagamento ? new Date(p.dataPagamento) : null,
    dataCredito: p.dataCredito ? new Date(p.dataCredito) : null,
    nsuTransacao: p.nsuTransacao,
    numeroAutorizacaoCartao: p.numeroAutorizacaoCartao,
    bandeiraMfe: p.bandeiraMfe,
    adquirenteMfe: p.adquirenteMfe,
    nroParcela: p.nroParcela,
    codigoCredenciadoraCartao: p.codigoCredenciadoraCartao,
    codigoContaCorrente: p.codigoContaCorrente,
    atualizadoEm: new Date(),
  }));

  await db
    .insert(schema.pagamento)
    .values(rows)
    .onConflictDoUpdate({
      target: [schema.pagamento.filialId, schema.pagamento.codigoExterno],
      set: {
        valor: drizzleSql`excluded.valor`,
        formaPagamento: drizzleSql`excluded.forma_pagamento`,
        percentualTaxa: drizzleSql`excluded.percentual_taxa`,
        dataPagamento: drizzleSql`excluded.data_pagamento`,
        dataCredito: drizzleSql`excluded.data_credito`,
        nsuTransacao: drizzleSql`excluded.nsu_transacao`,
        numeroAutorizacaoCartao: drizzleSql`excluded.numero_autorizacao_cartao`,
        bandeiraMfe: drizzleSql`excluded.bandeira_mfe`,
        adquirenteMfe: drizzleSql`excluded.adquirente_mfe`,
        nroParcela: drizzleSql`excluded.nro_parcela`,
        codigoCredenciadoraCartao: drizzleSql`excluded.codigo_credenciadora_cartao`,
        codigoContaCorrente: drizzleSql`excluded.codigo_conta_corrente`,
        atualizadoEm: drizzleSql`excluded.atualizado_em`,
      },
    });

  // 6. Atualiza sincronizacao
  const ultimoCodigo = pagamentos.reduce((max, p) => Math.max(max, p.codigoExterno), 0);
  await db
    .insert(schema.sincronizacao)
    .values({
      filialId: filial.id,
      ultimoCodigoExternoPagamento: ultimoCodigo,
      ultimaSincronizacao: new Date(),
      totalRegistrosSincronizados: pagamentos.length,
    })
    .onConflictDoUpdate({
      target: schema.sincronizacao.filialId,
      set: {
        ultimoCodigoExternoPagamento: drizzleSql`GREATEST(${schema.sincronizacao.ultimoCodigoExternoPagamento}, ${ultimoCodigo})`,
        ultimaSincronizacao: new Date(),
        totalRegistrosSincronizados: drizzleSql`${schema.sincronizacao.totalRegistrosSincronizados} + ${pagamentos.length}`,
      },
    });

  return NextResponse.json({ recebidos: pagamentos.length, ultimoCodigoExterno: ultimoCodigo });
}
