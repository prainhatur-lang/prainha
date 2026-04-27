// Página PÚBLICA pra cozinheiro acessar OP via link com token.
// Sem AppHeader. Layout mobile-first (otimizado pra celular na cozinha).

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';
import { CozinheiroOp } from './op-cliente';

export const dynamic = 'force-dynamic';

export default async function OpPublicaPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  if (!token || token.length < 20) notFound();

  const [op] = await db
    .select({
      id: schema.ordemProducao.id,
      descricao: schema.ordemProducao.descricao,
      observacao: schema.ordemProducao.observacao,
      responsavel: schema.ordemProducao.responsavel,
      status: schema.ordemProducao.status,
      enviadaEm: schema.ordemProducao.enviadaEm,
      marcadaProntaEm: schema.ordemProducao.marcadaProntaEm,
      marcadaProntaPor: schema.ordemProducao.marcadaProntaPor,
      concluidaEm: schema.ordemProducao.concluidaEm,
      filialId: schema.ordemProducao.filialId,
    })
    .from(schema.ordemProducao)
    .where(eq(schema.ordemProducao.tokenPublico, token))
    .limit(1);
  if (!op) notFound();

  const entradas = await db
    .select({
      id: schema.ordemProducaoEntrada.id,
      produtoId: schema.ordemProducaoEntrada.produtoId,
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
      pesoTotalKg: schema.ordemProducaoSaida.pesoTotalKg,
      observacao: schema.ordemProducaoSaida.observacao,
    })
    .from(schema.ordemProducaoSaida)
    .leftJoin(schema.produto, eq(schema.produto.id, schema.ordemProducaoSaida.produtoId))
    .where(eq(schema.ordemProducaoSaida.ordemProducaoId, op.id))
    .orderBy(asc(schema.ordemProducaoSaida.tipo), asc(schema.produto.nome));

  // Fotos da OP
  const fotos = await db
    .select({
      id: schema.ordemProducaoFoto.id,
      tipo: schema.ordemProducaoFoto.tipo,
      url: schema.ordemProducaoFoto.url,
      observacao: schema.ordemProducaoFoto.observacao,
      enviadaEm: schema.ordemProducaoFoto.enviadaEm,
    })
    .from(schema.ordemProducaoFoto)
    .where(eq(schema.ordemProducaoFoto.ordemProducaoId, op.id))
    .orderBy(asc(schema.ordemProducaoFoto.enviadaEm));

  // Produtos pra adicionar saídas extras (limitado pra mobile)
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

  const produtosUteis = produtos.filter((p) =>
    ['INSUMO', 'VENDA_SIMPLES', 'COMPLEMENTO'].includes(p.tipo),
  );

  // Colaboradores ativos da filial — sugestao no modal "marcar como pronta"
  const colaboradoresLista = await db
    .select({ nome: schema.colaborador.nome })
    .from(schema.colaborador)
    .where(
      and(
        eq(schema.colaborador.filialId, op.filialId),
        eq(schema.colaborador.ativo, true),
      ),
    )
    .orderBy(asc(schema.colaborador.nome))
    .limit(50);
  const sugestoesNomes = colaboradoresLista
    .map((c) => c.nome)
    .filter((n): n is string => Boolean(n));

  return (
    <main className="min-h-screen bg-slate-100">
      <CozinheiroOp
        token={token}
        op={{
          id: op.id,
          descricao: op.descricao,
          observacao: op.observacao,
          responsavel: op.responsavel,
          status: op.status,
          marcadaProntaEm: op.marcadaProntaEm ? op.marcadaProntaEm.toISOString() : null,
          marcadaProntaPor: op.marcadaProntaPor,
          concluidaEm: op.concluidaEm ? op.concluidaEm.toISOString() : null,
        }}
        entradas={entradas.map((e) => ({
          id: e.id,
          produtoId: e.produtoId,
          produtoNome: e.produtoNome ?? '',
          produtoUnidade: e.produtoUnidade,
          quantidade: e.quantidade,
        }))}
        saidas={saidas.map((s) => ({
          id: s.id,
          tipo: s.tipo,
          produtoId: s.produtoId,
          produtoNome: s.produtoNome,
          produtoUnidade: s.produtoUnidade,
          quantidade: s.quantidade,
          pesoRelativo: s.pesoRelativo,
          pesoTotalKg: s.pesoTotalKg,
          observacao: s.observacao,
        }))}
        produtos={produtosUteis.map((p) => ({
          id: p.id,
          nome: p.nome ?? '(sem nome)',
          unidade: p.unidade,
        }))}
        fotos={fotos.map((f) => ({
          id: f.id,
          tipo: f.tipo,
          url: f.url,
          observacao: f.observacao,
          enviadaEm: f.enviadaEm ? f.enviadaEm.toISOString() : null,
        }))}
        sugestoesNomes={sugestoesNomes}
      />
    </main>
  );
}
