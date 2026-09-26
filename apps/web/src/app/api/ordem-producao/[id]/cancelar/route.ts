// POST /api/ordem-producao/[id]/cancelar
// RASCUNHO → só marca CANCELADA (não tem movimento).
// CONCLUIDA → ESTORNA a produção, tudo numa transação com a OP travada:
//   - cada SAIDA_PRODUCAO (matéria-prima consumida) volta pro estoque como
//     ENTRADA_DEVOLUCAO, ao mesmo custo que saiu (MPM de novo);
//   - cada ENTRADA_PRODUCAO (o que foi produzido) sai como SAIDA_DEVOLUCAO e
//     o valor dela é tirado da média (desfazerMpmEntrada).
//   Os estornos apontam pro movimento original (movimento_pai_id) e pra OP.
//   Se o produzido já foi vendido/consumido, o saldo dele fica negativo — é o
//   retrato real (vendeu algo que, pela OP cancelada, nunca foi produzido);
//   a resposta avisa quais ficaram assim.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { aplicarMpmEntrada, desfazerMpmEntrada } from '@/lib/custo-medio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .innerJoin(schema.ordemProducao, eq(schema.ordemProducao.filialId, schema.usuarioFilial.filialId))
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.ordemProducao.id, id)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'OP nao encontrada ou sem acesso' }, { status: 404 });

  class Recusa extends Error {}

  try {
    const r = await db.transaction(async (tx) => {
      const [op] = await tx
        .select({
          id: schema.ordemProducao.id,
          filialId: schema.ordemProducao.filialId,
          status: schema.ordemProducao.status,
        })
        .from(schema.ordemProducao)
        .where(eq(schema.ordemProducao.id, id))
        .for('update')
        .limit(1);
      if (!op) throw new Recusa('OP nao encontrada');
      if (op.status === 'CANCELADA') throw new Recusa('OP ja esta cancelada');

      const estornos: Array<{ nome: string; tipo: string; quantidade: number; saldoNovo: number }> = [];

      if (op.status === 'CONCLUIDA') {
        const movs = await tx
          .select({
            id: schema.movimentoEstoque.id,
            produtoId: schema.movimentoEstoque.produtoId,
            tipo: schema.movimentoEstoque.tipo,
            quantidade: schema.movimentoEstoque.quantidade,
            precoUnitario: schema.movimentoEstoque.precoUnitario,
            nome: schema.produto.nome,
          })
          .from(schema.movimentoEstoque)
          .innerJoin(schema.produto, eq(schema.produto.id, schema.movimentoEstoque.produtoId))
          .where(
            and(
              eq(schema.movimentoEstoque.ordemProducaoId, id),
              inArray(schema.movimentoEstoque.tipo, ['SAIDA_PRODUCAO', 'ENTRADA_PRODUCAO']),
            ),
          );

        const jaEstornados = new Set(
          movs.length
            ? (
                await tx
                  .select({ pai: schema.movimentoEstoque.movimentoPaiId })
                  .from(schema.movimentoEstoque)
                  .where(inArray(schema.movimentoEstoque.movimentoPaiId, movs.map((m) => m.id)))
              ).map((x) => x.pai)
            : [],
        );

        const agora = new Date();
        for (const m of movs) {
          if (jaEstornados.has(m.id)) continue;
          const qtd = Math.abs(Number(m.quantidade));
          const preco = Number(m.precoUnitario ?? 0);
          const volta = m.tipo === 'SAIDA_PRODUCAO'; // matéria-prima volta pro estoque

          await tx.insert(schema.movimentoEstoque).values({
            filialId: op.filialId,
            produtoId: m.produtoId,
            tipo: volta ? 'ENTRADA_DEVOLUCAO' : 'SAIDA_DEVOLUCAO',
            quantidade: (volta ? qtd : -qtd).toFixed(4),
            precoUnitario: preco.toFixed(6),
            valorTotal: (qtd * preco).toFixed(2),
            dataHora: agora,
            ordemProducaoId: id,
            movimentoPaiId: m.id,
            criadoPor: user.id,
            observacao: 'Estorno: ordem de produção cancelada',
          });

          const saldoNovo = volta
            ? (await aplicarMpmEntrada({ produtoId: m.produtoId, qtdEntrada: qtd, custoEntrada: preco, exec: tx })).saldoNovo
            : (await desfazerMpmEntrada({ produtoId: m.produtoId, qtdEntrada: qtd, custoEntrada: preco, exec: tx })).saldoNovo;
          estornos.push({ nome: m.nome ?? m.produtoId, tipo: volta ? 'voltou' : 'saiu', quantidade: qtd, saldoNovo });
        }
      }

      await tx
        .update(schema.ordemProducao)
        .set({ status: 'CANCELADA' })
        .where(eq(schema.ordemProducao.id, id));

      return { estornos, eraConcluida: op.status === 'CONCLUIDA' };
    });

    return NextResponse.json({
      id,
      ok: true,
      estornou: r.eraConcluida,
      estornos: r.estornos,
      negativos: r.estornos.filter((e) => e.saldoNovo < 0).map((e) => e.nome),
    });
  } catch (e) {
    if (e instanceof Recusa) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
