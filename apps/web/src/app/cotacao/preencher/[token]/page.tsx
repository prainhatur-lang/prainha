// Pagina publica acessada pelo fornecedor via link unico (sem login).
// /cotacao/preencher/[token]
//
// O fornecedor preenche preço/marca por item e submete. Token expira em fechaEm.

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { and, eq, asc } from 'drizzle-orm';
import { PreencherForm } from './preencher-form';
import { lerExclusoesPorCotacao } from '@/lib/cotacao-exclusao';

export const dynamic = 'force-dynamic';

export default async function PreencherCotacaoPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await props.params;
  // Alguns botoes de URL dinamica da Meta ANEXAM a variavel no fim da base em
  // vez de substituir o {{1}} — chega "{{1}}cot_xxx". Limpa o prefixo {{N}}.
  const token = rawToken.replace(/^(\{\{\d+\}\})+/, '');

  // Busca cotacao_fornecedor pelo token
  const [cf] = await db
    .select({
      id: schema.cotacaoFornecedor.id,
      cotacaoId: schema.cotacaoFornecedor.cotacaoId,
      fornecedorId: schema.cotacaoFornecedor.fornecedorId,
      status: schema.cotacaoFornecedor.status,
      respondidoEm: schema.cotacaoFornecedor.respondidoEm,
      observacao: schema.cotacaoFornecedor.observacao,
    })
    .from(schema.cotacaoFornecedor)
    .where(eq(schema.cotacaoFornecedor.tokenPublico, token))
    .limit(1);
  if (!cf) notFound();

  const [cotacao] = await db
    .select()
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, cf.cotacaoId))
    .limit(1);
  if (!cotacao) notFound();

  const [fornecedor] = await db
    .select({ id: schema.fornecedor.id, nome: schema.fornecedor.nome })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, cf.fornecedorId))
    .limit(1);

  // Marca link como aberto (apenas a primeira vez)
  if (!cf.respondidoEm) {
    await db
      .update(schema.cotacaoFornecedor)
      .set({ linkAbertoEm: new Date() })
      .where(
        and(
          eq(schema.cotacaoFornecedor.id, cf.id),
          // so atualiza se ainda nao foi aberto
          // (evita sobrescrever timestamp da primeira abertura)
        ),
      );
  }

  const itensTodos = await db
    .select({
      id: schema.cotacaoItem.id,
      quantidade: schema.cotacaoItem.quantidade,
      unidade: schema.cotacaoItem.unidade,
      marcasAceitas: schema.cotacaoItem.marcasAceitas,
      embalagemEsperada: schema.cotacaoItem.embalagemEsperada,
      classificacao: schema.cotacaoItem.classificacao,
      observacao: schema.cotacaoItem.observacao,
      produtoNome: schema.produto.nome,
      categoria: schema.produto.categoriaCompras,
    })
    .from(schema.cotacaoItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.cotacaoItem.produtoId))
    .where(eq(schema.cotacaoItem.cotacaoId, cf.cotacaoId))
    .orderBy(asc(schema.produto.categoriaCompras), asc(schema.produto.nome));

  // Item que o gestor tirou da cotação DESTE fornecedor nem aparece pra ele.
  const excluidos = (await lerExclusoesPorCotacao(cf.cotacaoId)).get(cf.id) ?? new Set<string>();
  const itens = itensTodos.filter((i) => !excluidos.has(i.id));

  // Respostas existentes (caso fornecedor esteja editando antes do prazo)
  const respostas = await db
    .select({
      cotacaoItemId: schema.cotacaoRespostaItem.cotacaoItemId,
      precoUnitario: schema.cotacaoRespostaItem.precoUnitario,
      marcaTextoLivre: schema.cotacaoRespostaItem.marcaTextoLivre,
      unidadeFornecedor: schema.cotacaoRespostaItem.unidadeFornecedor,
      fatorConversao: schema.cotacaoRespostaItem.fatorConversao,
      observacao: schema.cotacaoRespostaItem.observacao,
      marcaNome: schema.marca.nome,
    })
    .from(schema.cotacaoRespostaItem)
    .leftJoin(schema.marca, eq(schema.marca.id, schema.cotacaoRespostaItem.marcaId))
    .where(eq(schema.cotacaoRespostaItem.cotacaoFornecedorId, cf.id));

  const expirou = cotacao.fechaEm && new Date() > new Date(cotacao.fechaEm);
  const jaRespondeu = cf.status === 'RESPONDIDA';

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">Cotação Prainha</p>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">
            Cotação #{cotacao.numero}
          </h1>
          <p className="mt-2 text-sm text-slate-700">
            Olá, <strong>{fornecedor?.nome ?? 'fornecedor'}</strong>! Preencha os preços (e marca,
            quando solicitada) dos itens que você fornece. Deixe em branco o que você não tem essa
            semana.
          </p>
          {cotacao.fechaEm && (
            <p className="mt-2 text-xs text-slate-500">
              Janela de resposta fecha em:{' '}
              <strong>{new Date(cotacao.fechaEm).toLocaleString('pt-BR')}</strong>
            </p>
          )}
          {cotacao.observacao && (
            <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-700">
              {cotacao.observacao}
            </p>
          )}
        </div>

        {expirou ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
            Esta cotação já fechou. Não é mais possível responder.
          </div>
        ) : (
          <>
          {jaRespondeu && (
            // Resposta enviada NÃO tranca o formulário: errou um preço, corrige
            // e reenvia até o fechamento (reenvio substitui a resposta inteira).
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              ✓ Você já enviou suas respostas. Se precisar corrigir algo, altere abaixo e
              envie de novo — vale a última versão enviada.
            </div>
          )}
          <PreencherForm
            token={token}
            freteInicial={
              // Frete gravado como "Taxa de frete: R$ 12,34" na observação da convocação
              /Taxa de frete: R\$ ?([\d.,]+)/.exec(cf.observacao ?? '')?.[1] ?? ''
            }
            itens={itens.map((i) => ({
              ...i,
              produtoNome: i.produtoNome ?? '',
              categoria: i.categoria ?? 'Outros',
              marcasAceitas: i.marcasAceitas
                ? i.marcasAceitas.split('|').filter(Boolean)
                : null,
            }))}
            respostasIniciais={respostas.reduce<
              Record<
                string,
                {
                  precoUnitario: string;
                  marca: string;
                  embalagem: string;
                  qtdPorEmbalagem: string;
                  observacao: string;
                }
              >
            >((acc, r) => {
              acc[r.cotacaoItemId] = {
                precoUnitario:
                  r.precoUnitario != null
                    ? Number(r.precoUnitario).toFixed(2).replace('.', ',')
                    : '',
                marca: r.marcaNome ?? r.marcaTextoLivre ?? '',
                embalagem: r.unidadeFornecedor ?? '',
                qtdPorEmbalagem:
                  r.fatorConversao != null && Number(r.fatorConversao) !== 1
                    ? String(Number(r.fatorConversao)).replace('.', ',')
                    : '',
                observacao: r.observacao ?? '',
              };
              return acc;
            }, {})}
          />
          </>
        )}
      </div>
    </main>
  );
}
