// GET /api/op/[token]
// Endpoint PÚBLICO (sem auth) — retorna dados da OP pra cozinheiro
// editar via /op/[token].
//
// Não retorna dados sensíveis (preços/custos). Só nome, qtd, unidade
// dos produtos. Cozinheiro precisa saber O QUE produzir, não o custo.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { asc, eq } from 'drizzle-orm';

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

  const [op] = await db
    .select({
      id: schema.ordemProducao.id,
      descricao: schema.ordemProducao.descricao,
      observacao: schema.ordemProducao.observacao,
      responsavel: schema.ordemProducao.responsavel,
      status: schema.ordemProducao.status,
      dataHora: schema.ordemProducao.dataHora,
      enviadaEm: schema.ordemProducao.enviadaEm,
      marcadaProntaEm: schema.ordemProducao.marcadaProntaEm,
      concluidaEm: schema.ordemProducao.concluidaEm,
      filialId: schema.ordemProducao.filialId,
    })
    .from(schema.ordemProducao)
    .where(eq(schema.ordemProducao.tokenPublico, token))
    .limit(1);

  if (!op) return NextResponse.json({ error: 'OP nao encontrada' }, { status: 404 });

  const entradas = await db
    .select({
      id: schema.ordemProducaoEntrada.id,
      produtoNome: schema.produto.nome,
      produtoUnidade: schema.produto.unidadeEstoque,
      quantidade: schema.ordemProducaoEntrada.quantidade,
    })
    .from(schema.ordemProducaoEntrada)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.ordemProducaoEntrada.produtoId))
    .where(eq(schema.ordemProducaoEntrada.ordemProducaoId, op.id))
    .orderBy(asc(schema.produto.nome));

  const saidas = await db
    .select({
      id: schema.ordemProducaoSaida.id,
      tipo: schema.ordemProducaoSaida.tipo,
      produtoId: schema.ordemProducaoSaida.produtoId,
      produtoNome: schema.produto.nome,
      produtoUnidade: schema.produto.unidadeEstoque,
      quantidade: schema.ordemProducaoSaida.quantidade,
      pesoRelativo: schema.ordemProducaoSaida.pesoRelativo,
      observacao: schema.ordemProducaoSaida.observacao,
    })
    .from(schema.ordemProducaoSaida)
    .leftJoin(schema.produto, eq(schema.produto.id, schema.ordemProducaoSaida.produtoId))
    .where(eq(schema.ordemProducaoSaida.ordemProducaoId, op.id))
    .orderBy(asc(schema.ordemProducaoSaida.tipo), asc(schema.produto.nome));

  // Lista de produtos da filial pra cozinheiro adicionar saídas extras
  // (limitada a INSUMO + VENDA_SIMPLES pra não poluir o mobile)
  const produtos = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      tipo: schema.produto.tipo,
      unidade: schema.produto.unidadeEstoque,
    })
    .from(schema.produto)
    .where(eq(schema.produto.filialId, op.filialId))
    .orderBy(asc(schema.produto.nome))
    .limit(2000);

  return NextResponse.json({
    op: {
      id: op.id,
      descricao: op.descricao,
      observacao: op.observacao,
      responsavel: op.responsavel,
      status: op.status,
      dataHora: op.dataHora ? op.dataHora.toISOString() : null,
      enviadaEm: op.enviadaEm ? op.enviadaEm.toISOString() : null,
      marcadaProntaEm: op.marcadaProntaEm ? op.marcadaProntaEm.toISOString() : null,
      concluidaEm: op.concluidaEm ? op.concluidaEm.toISOString() : null,
    },
    entradas: entradas.map((e) => ({
      id: e.id,
      produtoNome: e.produtoNome ?? '',
      produtoUnidade: e.produtoUnidade,
      quantidade: e.quantidade,
    })),
    saidas: saidas.map((s) => ({
      id: s.id,
      tipo: s.tipo,
      produtoId: s.produtoId,
      produtoNome: s.produtoNome,
      produtoUnidade: s.produtoUnidade,
      quantidade: s.quantidade,
      pesoRelativo: s.pesoRelativo,
      observacao: s.observacao,
    })),
    produtos: produtos
      .filter((p) => ['INSUMO', 'VENDA_SIMPLES', 'COMPLEMENTO'].includes(p.tipo))
      .map((p) => ({
        id: p.id,
        nome: p.nome ?? '(sem nome)',
        unidade: p.unidade,
      })),
  });
}
