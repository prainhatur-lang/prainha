// PATCH /api/nota-compra-item/[id]
// Opera o mapeamento do item ↔ produto interno. Body pode ser uma de duas formas:
//  1) { produtoId, fator? }  — vincula item ao produto existente
//  2) { produtoId: null }    — desvincula
// Quando vincula, se a nota tem fornecedorId, atualiza/cria o mapeamento em
// produto_fornecedor (upsert) gravando codigo + ean + descricao + unidade
// + fator de conversao vindo do request, pra o match-auto pegar automatica-
// mente nas proximas notas desse fornecedor.
//
// O fator de conversao traduz a unidade do fornecedor pra unidade interna:
// ex: NFe vem com 2 UN do "OLEO 15,8L"; produto interno e em LITROS, fator=15.8
// → na hora de lancar, qtdInterna = 2 * 15.8 = 31.6 L.

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  produtoId: z.string().uuid().nullable(),
  fator: z.number().positive().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const _semPerm = await negarSemPerm(user.id, 'nota_compra.vincular_produto');
  if (_semPerm) return _semPerm;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }

  const [item] = await db
    .select({
      id: schema.notaCompraItem.id,
      notaCompraId: schema.notaCompraItem.notaCompraId,
      filialId: schema.notaCompraItem.filialId,
      codigoProdutoFornecedor: schema.notaCompraItem.codigoProdutoFornecedor,
      ean: schema.notaCompraItem.ean,
      descricao: schema.notaCompraItem.descricao,
      unidade: schema.notaCompraItem.unidade,
      quantidade: schema.notaCompraItem.quantidade,
      valorUnitario: schema.notaCompraItem.valorUnitario,
    })
    .from(schema.notaCompraItem)
    .where(eq(schema.notaCompraItem.id, id))
    .limit(1);
  if (!item) return NextResponse.json({ error: 'item nao encontrado' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, item.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const [movExist] = await db
    .select({ id: schema.movimentoEstoque.id })
    .from(schema.movimentoEstoque)
    .where(eq(schema.movimentoEstoque.notaCompraItemId, id))
    .limit(1);
  if (movExist) {
    return NextResponse.json(
      { error: 'item ja foi lancado no estoque — desfaca o lancamento antes' },
      { status: 409 },
    );
  }

  const { produtoId, fator } = parsed.data;
  const fatorStr = fator != null ? String(fator) : null;

  if (produtoId) {
    const [prod] = await db
      .select({ id: schema.produto.id, filialId: schema.produto.filialId })
      .from(schema.produto)
      .where(eq(schema.produto.id, produtoId))
      .limit(1);
    if (!prod) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });
    if (prod.filialId !== item.filialId) {
      return NextResponse.json({ error: 'produto em filial diferente' }, { status: 400 });
    }
  }

  await db
    .update(schema.notaCompraItem)
    // semVinculoAuto: tirou o vínculo na mão → a abertura da entrada não repõe sozinha
    .set({ produtoId, semVinculoAuto: !produtoId })
    .where(eq(schema.notaCompraItem.id, id));

  // Se vinculou e nota tem fornecedor, upsert em produto_fornecedor pra
  // acelerar matches futuros do mesmo fornecedor com o mesmo código/EAN.
  let aviso: string | null = null;
  if (produtoId) {
    const [nota] = await db
      .select({ fornecedorId: schema.notaCompra.fornecedorId })
      .from(schema.notaCompra)
      .where(eq(schema.notaCompra.id, item.notaCompraId))
      .limit(1);

    if (nota?.fornecedorId && (item.codigoProdutoFornecedor || item.ean)) {
      const [existente] = await db
        .select({ id: schema.produtoFornecedor.id })
        .from(schema.produtoFornecedor)
        .where(
          and(
            eq(schema.produtoFornecedor.fornecedorId, nota.fornecedorId),
            eq(schema.produtoFornecedor.produtoId, produtoId),
          ),
        )
        .limit(1);

      if (!existente) {
        try {
          await db.insert(schema.produtoFornecedor).values({
            filialId: item.filialId,
            produtoId,
            fornecedorId: nota.fornecedorId,
            codigoFornecedor: item.codigoProdutoFornecedor,
            ean: item.ean,
            descricaoFornecedor: item.descricao,
            unidadeFornecedor: item.unidade,
            fatorConversao: fatorStr ?? '1',
          });
        } catch {
          // Conflito de unique: o mesmo código já está ligado a OUTRO produto
          // (14/10/2026: a CRBS mandou Corona Zero e Corona Extra com o mesmo
          // código). Antes o vínculo não era gravado e o fator digitado se
          // perdia — a caixa com 24 entrava como 1 un. Agora grava o vínculo
          // sem o código (o fator vale pelo produto) e avisa.
          const [dono] = item.codigoProdutoFornecedor
            ? await db
                .select({ nome: schema.produto.nome })
                .from(schema.produtoFornecedor)
                .innerJoin(schema.produto, eq(schema.produto.id, schema.produtoFornecedor.produtoId))
                .where(
                  and(
                    eq(schema.produtoFornecedor.fornecedorId, nota.fornecedorId),
                    eq(schema.produtoFornecedor.codigoFornecedor, item.codigoProdutoFornecedor),
                  ),
                )
                .limit(1)
            : [];
          try {
            await db.insert(schema.produtoFornecedor).values({
              filialId: item.filialId,
              produtoId,
              fornecedorId: nota.fornecedorId,
              codigoFornecedor: null,
              ean: item.ean,
              descricaoFornecedor: item.descricao,
              unidadeFornecedor: item.unidade,
              fatorConversao: fatorStr ?? '1',
            });
            aviso = `O código ${item.codigoProdutoFornecedor ?? ''} do fornecedor já está ligado a "${
              dono?.nome ?? 'outro produto'
            }". O vínculo deste item foi salvo sem o código, com o fator ${fatorStr ?? '1'}.`;
          } catch (e) {
            console.error('[nota-compra-item] vínculo sem código falhou', e);
            aviso = `O vínculo com o fornecedor não foi salvo (código ${item.codigoProdutoFornecedor ?? ''} já usado). Confira o fator antes de lançar.`;
          }
        }
      } else if (fatorStr != null) {
        // Ja existia o vinculo do produto com o fornecedor; o usuario quer
        // ajustar o fator nesse momento (ex: na 1a vez vinculou com fator
        // errado). Atualiza pra valer no proximo lancamento.
        await db
          .update(schema.produtoFornecedor)
          .set({ fatorConversao: fatorStr })
          .where(eq(schema.produtoFornecedor.id, existente.id));
      }
    } else if (nota?.fornecedorId) {
      // Item sem código nem EAN (pedido sem nota): guarda o vínculo pela
      // descrição do papel, pra próxima entrada desse fornecedor já vir com o
      // insumo e o fator — mesmo que esta entrada seja excluída depois.
      const [existente] = await db
        .select({ id: schema.produtoFornecedor.id, descricao: schema.produtoFornecedor.descricaoFornecedor })
        .from(schema.produtoFornecedor)
        .where(
          and(
            eq(schema.produtoFornecedor.fornecedorId, nota.fornecedorId),
            eq(schema.produtoFornecedor.produtoId, produtoId),
          ),
        )
        .limit(1);
      if (!existente) {
        await db.insert(schema.produtoFornecedor).values({
          filialId: item.filialId,
          produtoId,
          fornecedorId: nota.fornecedorId,
          descricaoFornecedor: item.descricao,
          unidadeFornecedor: item.unidade,
          fatorConversao: fatorStr ?? '1',
        });
      } else {
        await db
          .update(schema.produtoFornecedor)
          .set({
            ...(fatorStr != null ? { fatorConversao: fatorStr } : {}),
            ...(existente.descricao ? {} : { descricaoFornecedor: item.descricao }),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.produtoFornecedor.id, existente.id));
      }
    }
  }

  return NextResponse.json({ id, produtoId, fator: fatorStr ?? null, ...(aviso ? { aviso } : {}) });
}
