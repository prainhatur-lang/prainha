// POST /api/cotacao/[id]/registrar-resposta
// O GESTOR grava a resposta de um fornecedor (ex: fornecedor mandou os preços
// por WhatsApp e a resposta foi interpretada/conferida na tela de respostas).
//
// Diferenças do endpoint público /api/cotacao/preencher/[token]:
//   - exige login (gestor), não token
//   - NÃO trava por expiração: resposta que chegou atrasada ainda vale registrar
//   - marca fora da lista NÃO bloqueia: grava e devolve aviso (a resposta fica
//     registrada; o filtro de marcas aceitas já impede de vencer)
//
// Body: { cotacaoFornecedorId, respostas: [{ cotacaoItemId, precoUnitario,
//         marca, embalagem?, qtdPorEmbalagem?, observacao }] }
// Substitui TODAS as respostas do fornecedor (idempotente, igual ao público).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { normalizaMarca } from '@/lib/cotacao-alocacao';
import { lerExclusoesPorCotacao } from '@/lib/cotacao-exclusao';

interface RespostaIn {
  cotacaoItemId: string;
  precoUnitario: number;
  marca: string | null;
  embalagem?: string | null;
  qtdPorEmbalagem?: number | null;
  observacao: string | null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: cotacaoId } = await params;

  let body: { cotacaoFornecedorId?: string; respostas?: RespostaIn[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  if (!body.cotacaoFornecedorId) {
    return NextResponse.json({ error: 'cotacaoFornecedorId obrigatorio' }, { status: 400 });
  }

  const [cf] = await db
    .select({ id: schema.cotacaoFornecedor.id })
    .from(schema.cotacaoFornecedor)
    .where(
      and(
        eq(schema.cotacaoFornecedor.id, body.cotacaoFornecedorId),
        eq(schema.cotacaoFornecedor.cotacaoId, cotacaoId),
      ),
    )
    .limit(1);
  if (!cf) return NextResponse.json({ error: 'fornecedor nao convocado nesta cotacao' }, { status: 404 });

  const [cot] = await db
    .select({ id: schema.cotacao.id, filialId: schema.cotacao.filialId, status: schema.cotacao.status })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, cotacaoId))
    .limit(1);
  if (!cot) return NextResponse.json({ error: 'cotacao nao encontrada' }, { status: 404 });
  if (cot.status === 'CANCELADA' || cot.status === 'APROVADA' || cot.status === 'CONCLUIDA') {
    return NextResponse.json(
      { error: `cotacao ${cot.status.toLowerCase()} — nao da mais pra alterar respostas` },
      { status: 400 },
    );
  }

  const excluidos = (await lerExclusoesPorCotacao(cotacaoId)).get(cf.id) ?? new Set<string>();
  const respostas = (Array.isArray(body.respostas) ? body.respostas : []).filter(
    (r) => r.cotacaoItemId && !excluidos.has(r.cotacaoItemId) && Number(r.precoUnitario) > 0,
  );

  const itens = await db
    .select({
      id: schema.cotacaoItem.id,
      marcasAceitas: schema.cotacaoItem.marcasAceitas,
      produtoNome: schema.produto.nome,
    })
    .from(schema.cotacaoItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.cotacaoItem.produtoId))
    .where(eq(schema.cotacaoItem.cotacaoId, cotacaoId));
  const porItem = new Map(itens.map((i) => [i.id, i]));

  // Avisos (não bloqueiam): a resposta fica registrada do jeito que veio.
  const avisos: string[] = [];
  for (const r of respostas) {
    const item = porItem.get(r.cotacaoItemId);
    if (!item) continue;
    const aceitas = (item.marcasAceitas ?? '').split('|').map((m) => m.trim()).filter(Boolean);
    const marca = (r.marca ?? '').trim();
    if (!marca && aceitas.length > 0) {
      avisos.push(`${item.produtoNome}: sem marca (aceitas: ${aceitas.join(', ')}) — não vai disputar`);
    } else if (
      marca &&
      aceitas.length > 0 &&
      !aceitas.some((a) => normalizaMarca(a) === normalizaMarca(marca))
    ) {
      avisos.push(`${item.produtoNome}: marca "${marca}" fora das aceitas (${aceitas.join(', ')}) — não vai disputar`);
    }
  }

  async function acharOuCriarMarca(nome: string | null): Promise<string | null> {
    if (!nome || !nome.trim()) return null;
    const n = nome.trim();
    const existente = await db
      .select({ id: schema.marca.id })
      .from(schema.marca)
      .where(and(eq(schema.marca.filialId, cot.filialId), eq(schema.marca.nome, n)))
      .limit(1);
    if (existente[0]) return existente[0].id;
    const [novo] = await db
      .insert(schema.marca)
      .values({ filialId: cot.filialId, nome: n })
      .returning({ id: schema.marca.id });
    return novo.id;
  }

  // Substitui as respostas do fornecedor (mesma semântica do endpoint público)
  await db
    .delete(schema.cotacaoRespostaItem)
    .where(eq(schema.cotacaoRespostaItem.cotacaoFornecedorId, cf.id));

  for (const r of respostas) {
    if (!porItem.has(r.cotacaoItemId)) continue;
    const marcaId = await acharOuCriarMarca(r.marca);
    const precoNum = Number(r.precoUnitario);
    const fator =
      r.qtdPorEmbalagem != null && Number(r.qtdPorEmbalagem) > 0 ? Number(r.qtdPorEmbalagem) : 1;
    await db.insert(schema.cotacaoRespostaItem).values({
      cotacaoFornecedorId: cf.id,
      cotacaoItemId: r.cotacaoItemId,
      marcaId,
      marcaTextoLivre: marcaId ? null : r.marca ?? null,
      precoUnitario: String(precoNum),
      precoUnitarioNormalizado: String(precoNum / fator),
      unidadeFornecedor: r.embalagem?.slice(0, 40) ?? null,
      fatorConversao: String(fator),
      observacao: r.observacao,
    });
  }

  await db
    .update(schema.cotacaoFornecedor)
    .set({ status: 'RESPONDIDA', respondidoEm: new Date() })
    .where(eq(schema.cotacaoFornecedor.id, cf.id));

  return NextResponse.json({ ok: true, count: respostas.length, avisos });
}
