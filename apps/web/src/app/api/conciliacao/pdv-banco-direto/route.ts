// POST /api/conciliacao/pdv-banco-direto
// Body: { filialId, dataInicio, dataFim }
// Engine PDV(canal=DIRETO) <-> lancamento_banco (credito direto na conta).
// Cobre Pix Manual, TED, DOC. Persistencia em match_pdv_banco.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, gte, isNull, lte, notInArray, sql } from 'drizzle-orm';
import {
  matchPdvBancoDireto,
  type PdvDireto,
  type BancoCredito,
} from '@concilia/conciliador';
import { resolverParametros } from '@/lib/conciliacao-params';

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

  // Carrega parametros customizados da filial (com fallback pros defaults)
  const [filialRow] = await db
    .select({ parametrosConciliacao: schema.filial.parametrosConciliacao })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const params = resolverParametros(filialRow?.parametrosConciliacao);

  const dtIni = new Date(dataInicio + 'T00:00:00-03:00');
  const dtFim = new Date(dataFim + 'T23:59:59-03:00');

  // 1) Pagamentos PDV com canal=DIRETO no periodo (forma de pagamento mapeada)
  // 2) Que ainda nao tem match persistido
  const matchesExistentes = await db
    .select({ id: schema.matchPdvBanco.pagamentoId })
    .from(schema.matchPdvBanco)
    .where(eq(schema.matchPdvBanco.filialId, filialId));
  const idsJaCasados = matchesExistentes.map((m) => m.id);

  const pagamentosDireto = await db
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
        idsJaCasados.length > 0
          ? notInArray(schema.pagamento.id, idsJaCasados)
          : undefined,
      ),
    );

  const pdv: PdvDireto[] = pagamentosDireto
    .filter((p) => p.dataPagamento && p.formaPagamento)
    .map((p) => ({
      id: p.id,
      valor: Number(p.valor),
      data: p.dataPagamento!.toISOString().slice(0, 10),
      formaPagamento: p.formaPagamento!,
    }));

  // 3) Creditos no banco no periodo (apenas C = credito) que ainda nao foram
  //    casados (com PDV-DIRETO ou ja conciliados com cielo via outro fluxo)
  const matchesBancoExistentes = await db
    .select({ id: schema.matchPdvBanco.lancamentoBancoId })
    .from(schema.matchPdvBanco)
    .where(eq(schema.matchPdvBanco.filialId, filialId));
  const idsLancamentosCasados = matchesBancoExistentes.map((m) => m.id);

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
        idsLancamentosCasados.length > 0
          ? notInArray(schema.lancamentoBanco.id, idsLancamentosCasados)
          : undefined,
      ),
    );

  const banco: BancoCredito[] = creditosBanco.map((c) => ({
    id: c.id,
    valor: Number(c.valor),
    data: c.dataMovimento,
    descricao: c.descricao ?? '',
  }));

  // 4) Roda engine com parametros da filial
  const resultado = matchPdvBancoDireto(pdv, banco, params.pdvBancoDireto);

  // 5) Persiste matches
  if (resultado.matched.length > 0) {
    const linhas = resultado.matched.map((m) => ({
      filialId,
      pagamentoId: m.pdv.id,
      lancamentoBancoId: m.banco.id,
      nivelMatch: String(m.nivel),
      criadoPor: 'AUTO',
    }));
    await db
      .insert(schema.matchPdvBanco)
      .values(linhas)
      .onConflictDoNothing({
        target: [schema.matchPdvBanco.pagamentoId],
      });
  }

  // 6) Registra execucao
  const totalPdv = pdv.length;
  const totalBanco = banco.length;
  const matched = resultado.matched.length;
  const matchedNivel1 = resultado.matched.filter((m) => m.nivel === 1).length;
  const matchedNivel2 = resultado.matched.filter((m) => m.nivel === 2).length;
  const pdvSemBanco = resultado.pdvSemBanco.length;
  const bancoSemPdv = resultado.bancoSemPdv.length;

  await db.insert(schema.execucaoConciliacao).values({
    filialId,
    processo: 'PDV_BANCO_DIRETO',
    dataInicio: dtIni,
    dataFim: dtFim,
    iniciadoEm: new Date(),
    finalizadoEm: new Date(),
    status: 'OK',
    resumo: {
      totalPdv,
      totalBanco,
      matched,
      matchedNivel1,
      matchedNivel2,
      pdvSemBanco,
      bancoSemPdv,
      valorMatched: resultado.matched.reduce((s, m) => s + m.pdv.valor, 0),
      valorPdvSemBanco: resultado.pdvSemBanco.reduce((s, p) => s + p.valor, 0),
      valorBancoSemPdv: resultado.bancoSemPdv.reduce((s, b) => s + b.valor, 0),
    },
  });

  return NextResponse.json({
    ok: true,
    matched,
    matchedNivel1,
    matchedNivel2,
    pdvSemBanco,
    bancoSemPdv,
    totalPdv,
    totalBanco,
  });
}
