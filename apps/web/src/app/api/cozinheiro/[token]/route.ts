// GET /api/cozinheiro/[token]
// Endpoint PÚBLICO — retorna dados do colaborador + lista de OPs ativas
// dele (RASCUNHO ou marcadas pronta mas ainda não concluídas pelo gestor)
// + histórico recente de OPs concluídas (pra contexto).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'token invalido' }, { status: 400 });
  }

  const [colab] = await db
    .select({
      id: schema.colaborador.id,
      nome: schema.colaborador.nome,
      filialId: schema.colaborador.filialId,
      ativo: schema.colaborador.ativo,
    })
    .from(schema.colaborador)
    .where(eq(schema.colaborador.tokenAcesso, token))
    .limit(1);

  if (!colab) return NextResponse.json({ error: 'colaborador nao encontrado' }, { status: 404 });
  if (!colab.ativo) {
    return NextResponse.json({ error: 'colaborador inativo' }, { status: 403 });
  }

  // OPs do colaborador filtradas por:
  // - mesma filial
  // - responsavel = nome do colab (case-sensitive — colaborador é cadastrado normalizado)
  const ativas = await db
    .select({
      id: schema.ordemProducao.id,
      descricao: schema.ordemProducao.descricao,
      observacao: schema.ordemProducao.observacao,
      status: schema.ordemProducao.status,
      dataHora: schema.ordemProducao.dataHora,
      enviadaEm: schema.ordemProducao.enviadaEm,
      marcadaProntaEm: schema.ordemProducao.marcadaProntaEm,
      tokenPublico: schema.ordemProducao.tokenPublico,
      qtdEntradas: sql<number>`(SELECT COUNT(*)::int FROM ${schema.ordemProducaoEntrada} WHERE ${schema.ordemProducaoEntrada.ordemProducaoId} = ${schema.ordemProducao.id})`,
      qtdSaidas: sql<number>`(SELECT COUNT(*)::int FROM ${schema.ordemProducaoSaida} WHERE ${schema.ordemProducaoSaida.ordemProducaoId} = ${schema.ordemProducao.id})`,
      qtdFotos: sql<number>`(SELECT COUNT(*)::int FROM ${schema.ordemProducaoFoto} WHERE ${schema.ordemProducaoFoto.ordemProducaoId} = ${schema.ordemProducao.id})`,
    })
    .from(schema.ordemProducao)
    .where(
      and(
        eq(schema.ordemProducao.filialId, colab.filialId),
        eq(schema.ordemProducao.responsavel, colab.nome),
        eq(schema.ordemProducao.status, 'RASCUNHO'),
        isNotNull(schema.ordemProducao.tokenPublico),
      ),
    )
    .orderBy(desc(schema.ordemProducao.dataHora));

  // OPs já concluídas — últimas 10 pra histórico/referência
  const concluidas = await db
    .select({
      id: schema.ordemProducao.id,
      descricao: schema.ordemProducao.descricao,
      status: schema.ordemProducao.status,
      concluidaEm: schema.ordemProducao.concluidaEm,
      tokenPublico: schema.ordemProducao.tokenPublico,
    })
    .from(schema.ordemProducao)
    .where(
      and(
        eq(schema.ordemProducao.filialId, colab.filialId),
        eq(schema.ordemProducao.responsavel, colab.nome),
        or(
          eq(schema.ordemProducao.status, 'CONCLUIDA'),
          eq(schema.ordemProducao.status, 'CANCELADA'),
        ),
        isNotNull(schema.ordemProducao.tokenPublico),
      ),
    )
    .orderBy(desc(schema.ordemProducao.concluidaEm))
    .limit(10);

  return NextResponse.json({
    colaborador: {
      id: colab.id,
      nome: colab.nome,
    },
    ativas: ativas.map((op) => ({
      id: op.id,
      tokenPublico: op.tokenPublico,
      descricao: op.descricao,
      observacao: op.observacao,
      status: op.status,
      dataHora: op.dataHora ? op.dataHora.toISOString() : null,
      enviadaEm: op.enviadaEm ? op.enviadaEm.toISOString() : null,
      marcadaProntaEm: op.marcadaProntaEm ? op.marcadaProntaEm.toISOString() : null,
      qtdEntradas: op.qtdEntradas,
      qtdSaidas: op.qtdSaidas,
      qtdFotos: op.qtdFotos,
    })),
    concluidas: concluidas.map((op) => ({
      id: op.id,
      tokenPublico: op.tokenPublico,
      descricao: op.descricao,
      status: op.status,
      concluidaEm: op.concluidaEm ? op.concluidaEm.toISOString() : null,
    })),
  });
}
