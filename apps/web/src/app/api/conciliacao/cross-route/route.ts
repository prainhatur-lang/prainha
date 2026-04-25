// POST /api/conciliacao/cross-route
// Body: { filialId, dataInicio, dataFim }
// Engine cross-route fallback: detecta pagamentos que provavelmente foram
// registrados em canal errado (Pix Online <-> Pix Manual confundido pelo
// garcom). Gera sugestoes que precisam ser aceitas manualmente.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, gte, lte, notInArray, sql } from 'drizzle-orm';
import {
  sugerirAdquirenteParaBanco,
  sugerirDiretoParaCielo,
  type PdvOrfao,
  type BancoDisponivel,
  type CieloDisponivel,
} from '@concilia/conciliador';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  filialId: z.string().uuid(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { filialId, dataInicio, dataFim } = parsed.data;

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const dtIni = new Date(dataInicio + 'T00:00:00-03:00');
  const dtFim = new Date(dataFim + 'T23:59:59-03:00');

  // Limpa sugestoes abertas antigas no periodo (preserva aceitas/rejeitadas)
  await db
    .delete(schema.sugestaoCrossRoute)
    .where(
      and(
        eq(schema.sugestaoCrossRoute.filialId, filialId),
        sql`${schema.sugestaoCrossRoute.aceitoEm} IS NULL`,
        sql`${schema.sugestaoCrossRoute.rejeitadoEm} IS NULL`,
      ),
    );

  // ========================================
  // 1) PDV(ADQUIRENTE) sem match na Cielo
  // ========================================
  // Pagamentos com forma_pagamento_canal=ADQUIRENTE e que apareceram em
  // excecao tipo PDV_SEM_CIELO (i.e. nao casaram).
  const pdvAdquirenteOrfaos = await db
    .select({
      id: schema.pagamento.id,
      valor: schema.pagamento.valor,
      dataPagamento: schema.pagamento.dataPagamento,
      formaPagamento: schema.pagamento.formaPagamento,
    })
    .from(schema.pagamento)
    .innerJoin(
      schema.formaPagamentoCanal,
      and(
        eq(schema.formaPagamentoCanal.filialId, filialId),
        eq(schema.formaPagamentoCanal.formaPagamento, schema.pagamento.formaPagamento),
        eq(schema.formaPagamentoCanal.canal, 'ADQUIRENTE'),
      ),
    )
    .innerJoin(
      schema.excecao,
      and(
        eq(schema.excecao.pagamentoId, schema.pagamento.id),
        eq(schema.excecao.processo, 'OPERADORA'),
        eq(schema.excecao.tipo, 'PDV_SEM_CIELO'),
        sql`${schema.excecao.aceitaEm} IS NULL`,
      ),
    )
    .where(
      and(
        eq(schema.pagamento.filialId, filialId),
        gte(schema.pagamento.dataPagamento, dtIni),
        lte(schema.pagamento.dataPagamento, dtFim),
      ),
    );

  // Creditos no banco no periodo, ainda nao casados (com PDV-DIRETO)
  const matchesBanco = await db
    .select({ id: schema.matchPdvBanco.lancamentoBancoId })
    .from(schema.matchPdvBanco)
    .where(eq(schema.matchPdvBanco.filialId, filialId));
  const bancoCasados = matchesBanco.map((m) => m.id);

  const creditosBanco = await db
    .select({
      id: schema.lancamentoBanco.id,
      valor: schema.lancamentoBanco.valor,
      dataMovimento: schema.lancamentoBanco.dataMovimento,
      descricao: schema.lancamentoBanco.descricao,
    })
    .from(schema.lancamentoBanco)
    .innerJoin(
      schema.contaBancaria,
      eq(schema.contaBancaria.id, schema.lancamentoBanco.contaBancariaId),
    )
    .where(
      and(
        eq(schema.contaBancaria.filialId, filialId),
        eq(schema.lancamentoBanco.tipo, 'C'),
        gte(schema.lancamentoBanco.dataMovimento, dataInicio),
        lte(schema.lancamentoBanco.dataMovimento, dataFim),
        bancoCasados.length > 0
          ? notInArray(schema.lancamentoBanco.id, bancoCasados)
          : undefined,
      ),
    );

  const pdvAdquirenteIn: PdvOrfao[] = pdvAdquirenteOrfaos
    .filter((p) => p.dataPagamento && p.formaPagamento)
    .map((p) => ({
      id: p.id,
      valor: Number(p.valor),
      data: p.dataPagamento!.toISOString().slice(0, 10),
      formaPagamento: p.formaPagamento!,
    }));
  const bancoIn: BancoDisponivel[] = creditosBanco.map((b) => ({
    id: b.id,
    valor: Number(b.valor),
    data: b.dataMovimento,
    descricao: b.descricao ?? '',
  }));

  const sugAdquirenteBanco = sugerirAdquirenteParaBanco(pdvAdquirenteIn, bancoIn);

  // ========================================
  // 2) PDV(DIRETO) sem match no banco
  // ========================================
  const matchesPdvBanco = await db
    .select({ id: schema.matchPdvBanco.pagamentoId })
    .from(schema.matchPdvBanco)
    .where(eq(schema.matchPdvBanco.filialId, filialId));
  const pdvCasados = matchesPdvBanco.map((m) => m.id);

  const pdvDiretoOrfaos = await db
    .select({
      id: schema.pagamento.id,
      valor: schema.pagamento.valor,
      dataPagamento: schema.pagamento.dataPagamento,
      formaPagamento: schema.pagamento.formaPagamento,
    })
    .from(schema.pagamento)
    .innerJoin(
      schema.formaPagamentoCanal,
      and(
        eq(schema.formaPagamentoCanal.filialId, filialId),
        eq(schema.formaPagamentoCanal.formaPagamento, schema.pagamento.formaPagamento),
        eq(schema.formaPagamentoCanal.canal, 'DIRETO'),
      ),
    )
    .where(
      and(
        eq(schema.pagamento.filialId, filialId),
        gte(schema.pagamento.dataPagamento, dtIni),
        lte(schema.pagamento.dataPagamento, dtFim),
        pdvCasados.length > 0 ? notInArray(schema.pagamento.id, pdvCasados) : undefined,
      ),
    );

  // Vendas Cielo no periodo (todas — engine filtra por valor+data)
  const vendasCielo = await db
    .select({
      id: schema.vendaAdquirente.id,
      nsu: schema.vendaAdquirente.nsu,
      valorBruto: schema.vendaAdquirente.valorBruto,
      dataVenda: schema.vendaAdquirente.dataVenda,
      formaPagamento: schema.vendaAdquirente.formaPagamento,
    })
    .from(schema.vendaAdquirente)
    .where(
      and(
        eq(schema.vendaAdquirente.filialId, filialId),
        gte(schema.vendaAdquirente.dataVenda, dataInicio),
        lte(schema.vendaAdquirente.dataVenda, dataFim),
      ),
    );

  const pdvDiretoIn: PdvOrfao[] = pdvDiretoOrfaos
    .filter((p) => p.dataPagamento && p.formaPagamento)
    .map((p) => ({
      id: p.id,
      valor: Number(p.valor),
      data: p.dataPagamento!.toISOString().slice(0, 10),
      formaPagamento: p.formaPagamento!,
    }));
  const cieloIn: CieloDisponivel[] = vendasCielo.map((v) => ({
    id: v.id,
    nsu: v.nsu,
    valorBruto: Number(v.valorBruto),
    dataVenda: v.dataVenda,
    formaPagamento: v.formaPagamento ?? '',
  }));

  const sugDiretoCielo = sugerirDiretoParaCielo(pdvDiretoIn, cieloIn);

  // ========================================
  // 3) Persiste todas as sugestoes
  // ========================================
  const todasSugestoes = [...sugAdquirenteBanco, ...sugDiretoCielo];
  if (todasSugestoes.length > 0) {
    const linhas = todasSugestoes.map((s) => ({
      filialId,
      pagamentoId: s.pagamentoId,
      tipo: s.tipo,
      lancamentoBancoId: s.lancamentoBancoId ?? null,
      vendaAdquirenteId: s.vendaAdquirenteId ?? null,
      score: String(s.score),
      motivo: s.motivo,
    }));
    await db
      .insert(schema.sugestaoCrossRoute)
      .values(linhas)
      .onConflictDoNothing({
        target: [schema.sugestaoCrossRoute.pagamentoId],
      });
  }

  return NextResponse.json({
    ok: true,
    sugestoes: todasSugestoes.length,
    adquirenteParaBanco: sugAdquirenteBanco.length,
    diretoParaCielo: sugDiretoCielo.length,
  });
}
