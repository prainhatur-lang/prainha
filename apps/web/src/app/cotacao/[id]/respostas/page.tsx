// /cotacao/[id]/respostas — matriz item × fornecedor com TODOS os valores
// respondidos, botão pra tirar um item da cotação de um fornecedor específico
// e "Colar resposta do WhatsApp" (IA interpreta o texto e o gestor confirma).

import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { db, schema } from '@concilia/db';
import { eq, asc, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { formatDateTime } from '@/lib/format';
import { lerExclusoesPorCotacao } from '@/lib/cotacao-exclusao';
import { RespostasClient } from './respostas-client';

export const dynamic = 'force-dynamic';

export default async function CotacaoRespostasPage(props: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'cotacao.read');

  const { id } = await props.params;

  const [c] = await db.select().from(schema.cotacao).where(eq(schema.cotacao.id, id)).limit(1);
  if (!c) notFound();

  const itens = await db
    .select({
      id: schema.cotacaoItem.id,
      quantidade: schema.cotacaoItem.quantidade,
      unidade: schema.cotacaoItem.unidade,
      marcasAceitas: schema.cotacaoItem.marcasAceitas,
      embalagemEsperada: schema.cotacaoItem.embalagemEsperada,
      classificacao: schema.cotacaoItem.classificacao,
      produtoNome: schema.produto.nome,
      categoria: schema.produto.categoriaCompras,
    })
    .from(schema.cotacaoItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.cotacaoItem.produtoId))
    .where(eq(schema.cotacaoItem.cotacaoId, id))
    .orderBy(asc(schema.produto.categoriaCompras), asc(schema.produto.nome));

  const fornecedores = await db
    .select({
      cfId: schema.cotacaoFornecedor.id,
      status: schema.cotacaoFornecedor.status,
      respondidoEm: schema.cotacaoFornecedor.respondidoEm,
      linkAbertoEm: schema.cotacaoFornecedor.linkAbertoEm,
      nome: schema.fornecedor.nome,
    })
    .from(schema.cotacaoFornecedor)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.cotacaoFornecedor.fornecedorId))
    .where(eq(schema.cotacaoFornecedor.cotacaoId, id))
    .orderBy(asc(schema.fornecedor.nome));

  const respostas =
    fornecedores.length === 0
      ? []
      : await db
          .select({
            cfId: schema.cotacaoRespostaItem.cotacaoFornecedorId,
            itemId: schema.cotacaoRespostaItem.cotacaoItemId,
            preco: schema.cotacaoRespostaItem.precoUnitario,
            precoNorm: schema.cotacaoRespostaItem.precoUnitarioNormalizado,
            fator: schema.cotacaoRespostaItem.fatorConversao,
            embalagem: schema.cotacaoRespostaItem.unidadeFornecedor,
            observacao: schema.cotacaoRespostaItem.observacao,
            marcaNome: schema.marca.nome,
            marcaTexto: schema.cotacaoRespostaItem.marcaTextoLivre,
          })
          .from(schema.cotacaoRespostaItem)
          .leftJoin(schema.marca, eq(schema.marca.id, schema.cotacaoRespostaItem.marcaId))
          .where(
            inArray(
              schema.cotacaoRespostaItem.cotacaoFornecedorId,
              fornecedores.map((f) => f.cfId),
            ),
          );

  const exclusoesMap = await lerExclusoesPorCotacao(id);
  const exclusoes: Record<string, string[]> = {};
  for (const [cfId, set] of exclusoesMap) exclusoes[cfId] = [...set];

  const podeEditar = c.status === 'ABERTA' || c.status === 'AGUARDANDO_APROVACAO' || c.status === 'RASCUNHO';

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="mb-4">
          <Link href={`/cotacao/${id}`} className="text-xs text-slate-500 hover:underline">
            ← Cotação #{c.numero}
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">
            Respostas — Cotação #{c.numero}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {c.fechaEm && (
              <>Fecha em <strong>{formatDateTime(c.fechaEm)}</strong> · </>
            )}
            Quem respondeu o quê, item por item. Menor preço válido em verde. Passe o mouse na
            célula pra tirar o item da cotação de um fornecedor.
          </p>
        </div>

        <RespostasClient
          cotacaoId={id}
          podeEditar={podeEditar}
          itens={itens.map((i) => ({
            id: i.id,
            produtoNome: i.produtoNome ?? '',
            categoria: i.categoria ?? 'Outros',
            quantidade: String(Number(i.quantidade)),
            unidade: i.unidade,
            marcasAceitas: (i.marcasAceitas ?? '').split('|').filter(Boolean),
            embalagemEsperada: i.embalagemEsperada,
            classificacao: i.classificacao,
          }))}
          fornecedores={fornecedores.map((f) => ({
            cfId: f.cfId,
            nome: f.nome ?? '?',
            status: f.status,
            respondidoEm: f.respondidoEm ? formatDateTime(f.respondidoEm) : null,
            linkAbertoEm: f.linkAbertoEm ? formatDateTime(f.linkAbertoEm) : null,
          }))}
          respostas={respostas.map((r) => ({
            cfId: r.cfId,
            itemId: r.itemId,
            preco: r.preco != null ? Number(r.preco) : null,
            precoNorm: r.precoNorm != null ? Number(r.precoNorm) : null,
            fator: r.fator != null ? Number(r.fator) : 1,
            embalagem: r.embalagem,
            marca: r.marcaNome ?? r.marcaTexto,
            observacao: r.observacao,
          }))}
          exclusoesIniciais={exclusoes}
        />
      </div>
    </main>
  );
}
