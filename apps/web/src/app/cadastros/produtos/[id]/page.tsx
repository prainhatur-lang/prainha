import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, inArray, isNull, sql as sqlDrizzle } from 'drizzle-orm';
import { alias as aliasDrizzle } from 'drizzle-orm/pg-core';
import { AppHeader } from '@/components/app-header';
import { AbaFicha } from './aba-ficha';
import { AbaFornecedores } from './aba-fornecedores';
import { AbaSaldo } from './aba-saldo';
import { AbaMarcas } from './aba-marcas';
import { AbaPdv } from './aba-pdv';
import { TrocarTipoButton } from './trocar-tipo';

export const dynamic = 'force-dynamic';

interface SP {
  aba?: 'ficha' | 'fornecedores' | 'saldo' | 'marcas' | 'pdv';
}

const BADGE_TIPO: Record<string, { label: string; cls: string }> = {
  VENDA_SIMPLES: { label: 'Produto', cls: 'bg-emerald-100 text-emerald-800' },
  INSUMO: { label: 'Insumo', cls: 'bg-sky-100 text-sky-800' },
  COMPLEMENTO: { label: 'Complemento', cls: 'bg-amber-100 text-amber-800' },
  COMBO: { label: 'Combo', cls: 'bg-violet-100 text-violet-800' },
  VARIANTE: { label: 'Tamanho', cls: 'bg-indigo-100 text-indigo-800' },
  SERVICO: { label: 'Serviço', cls: 'bg-slate-100 text-slate-700' },
};

export default async function ProdutoDetalhePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const sp = await props.searchParams;
  const aba: 'ficha' | 'fornecedores' | 'saldo' | 'marcas' | 'pdv' =
    sp.aba === 'fornecedores'
      ? 'fornecedores'
      : sp.aba === 'saldo'
        ? 'saldo'
        : sp.aba === 'marcas'
          ? 'marcas'
          : sp.aba === 'pdv'
            ? 'pdv'
            : 'ficha';

  const [produto] = await db
    .select()
    .from(schema.produto)
    .where(eq(schema.produto.id, id))
    .limit(1);
  if (!produto) notFound();

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, produto.filialId),
      ),
    )
    .limit(1);
  if (!link) notFound();

  const badge = BADGE_TIPO[produto.tipo] ?? { label: produto.tipo, cls: 'bg-slate-100' };

  // Ficha técnica (produto → insumos)
  const fichaRows = await db
    .select({
      id: schema.fichaTecnica.id,
      insumoId: schema.fichaTecnica.insumoId,
      quantidade: schema.fichaTecnica.quantidade,
      baixaEstoque: schema.fichaTecnica.baixaEstoque,
      observacao: schema.fichaTecnica.observacao,
      insumoNome: schema.produto.nome,
      insumoTipo: schema.produto.tipo,
      insumoUnidade: schema.produto.unidadeEstoque,
      insumoControla: schema.produto.controlaEstoque,
    })
    .from(schema.fichaTecnica)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.fichaTecnica.insumoId))
    .where(eq(schema.fichaTecnica.produtoId, id))
    .orderBy(asc(schema.produto.nome));

  // Onde esse produto é usado como insumo (ficha reversa)
  const usadoEmRows = await db
    .select({
      id: schema.fichaTecnica.id,
      produtoId: schema.fichaTecnica.produtoId,
      quantidade: schema.fichaTecnica.quantidade,
      produtoNome: schema.produto.nome,
    })
    .from(schema.fichaTecnica)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.fichaTecnica.produtoId))
    .where(eq(schema.fichaTecnica.insumoId, id))
    .orderBy(asc(schema.produto.nome));

  // Lista de insumos disponíveis pra adicionar na ficha (filial do produto, INSUMO ou VENDA_SIMPLES com controlaEstoque)
  const insumosDisponiveis = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      tipo: schema.produto.tipo,
      unidade: schema.produto.unidadeEstoque,
    })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, produto.filialId),
        eq(schema.produto.controlaEstoque, true),
      ),
    )
    .orderBy(asc(schema.produto.nome))
    .limit(1000);

  // Fornecedores mapeados
  const fornecedoresRows = await db
    .select({
      id: schema.produtoFornecedor.id,
      fornecedorId: schema.produtoFornecedor.fornecedorId,
      fornecedorNome: schema.fornecedor.nome,
      fornecedorCnpj: schema.fornecedor.cnpjOuCpf,
      codigoFornecedor: schema.produtoFornecedor.codigoFornecedor,
      ean: schema.produtoFornecedor.ean,
      descricaoFornecedor: schema.produtoFornecedor.descricaoFornecedor,
      unidadeFornecedor: schema.produtoFornecedor.unidadeFornecedor,
      fatorConversao: schema.produtoFornecedor.fatorConversao,
      ultimoPrecoCusto: schema.produtoFornecedor.ultimoPrecoCusto,
      ultimoPrecoCustoUnidade: schema.produtoFornecedor.ultimoPrecoCustoUnidade,
      ultimaCompraEm: schema.produtoFornecedor.ultimaCompraEm,
    })
    .from(schema.produtoFornecedor)
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.produtoFornecedor.fornecedorId))
    .where(eq(schema.produtoFornecedor.produtoId, id))
    .orderBy(asc(schema.fornecedor.nome));

  // Lista de fornecedores disponíveis (filial + não deletados)
  const fornecedoresDisponiveis = await db
    .select({
      id: schema.fornecedor.id,
      nome: schema.fornecedor.nome,
      cnpjOuCpf: schema.fornecedor.cnpjOuCpf,
    })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.filialId, produto.filialId))
    .orderBy(asc(schema.fornecedor.nome))
    .limit(1000);

  // Movimentos do produto (pra histórico de custo + log)
  const movimentos =
    aba === 'saldo'
      ? await db
          .select({
            id: schema.movimentoEstoque.id,
            tipo: schema.movimentoEstoque.tipo,
            quantidade: schema.movimentoEstoque.quantidade,
            precoUnitario: schema.movimentoEstoque.precoUnitario,
            valorTotal: schema.movimentoEstoque.valorTotal,
            dataHora: schema.movimentoEstoque.dataHora,
            observacao: schema.movimentoEstoque.observacao,
            notaCompraItemId: schema.movimentoEstoque.notaCompraItemId,
            ordemProducaoId: schema.movimentoEstoque.ordemProducaoId,
            pedidoItemId: schema.movimentoEstoque.pedidoItemId,
          })
          .from(schema.movimentoEstoque)
          .where(eq(schema.movimentoEstoque.produtoId, id))
          .orderBy(desc(schema.movimentoEstoque.dataHora), desc(schema.movimentoEstoque.criadoEm))
          .limit(200)
      : [];

  // CADASTRO DO PDV: tamanhos (PRODUTODETALHE), categorias (ETIQUETAS) e o que
  // está na fila esperando a loja aplicar. Só carrega na aba, que é consulta
  // extra em página que já faz várias.
  const variantesPdv =
    aba === 'pdv' && produto.codigoExterno != null
      ? await db
          .select({
            codigo: schema.produtoVariante.codigoExterno,
            tamanho: schema.produtoTamanho.descricao,
            precoVenda: schema.produtoVariante.precoVenda,
            dataPausado: schema.produtoVariante.dataPausado,
            comandaMobile: schema.produtoVariante.comandaMobile,
            cardapioDigital: schema.produtoVariante.cardapioDigital,
            codigoBarra: schema.produtoVariante.codigoBarra,
          })
          .from(schema.produtoVariante)
          .leftJoin(
            schema.produtoTamanho,
            eq(schema.produtoTamanho.id, schema.produtoVariante.produtoTamanhoId),
          )
          .where(
            and(
              eq(schema.produtoVariante.filialId, produto.filialId),
              eq(schema.produtoVariante.codigoProdutoExterno, produto.codigoExterno),
              isNull(schema.produtoVariante.dataDelete),
            ),
          )
          .orderBy(asc(schema.produtoVariante.codigoExterno))
      : [];

  const etiquetasPdv =
    aba === 'pdv'
      ? await db
          .select({ codigo: schema.produtoEtiqueta.codigoExterno, nome: schema.produtoEtiqueta.nome })
          .from(schema.produtoEtiqueta)
          .where(eq(schema.produtoEtiqueta.filialId, produto.filialId))
          .orderBy(asc(schema.produtoEtiqueta.nome))
      : [];

  const pendentesPdv =
    aba === 'pdv'
      ? await db
          .select({
            id: schema.produtoAlteracao.id,
            campo: schema.produtoAlteracao.campo,
            valor: schema.produtoAlteracao.valor,
            valorAntes: schema.produtoAlteracao.valorAntes,
            erro: schema.produtoAlteracao.erro,
            varianteCodigoExterno: schema.produtoAlteracao.varianteCodigoExterno,
          })
          .from(schema.produtoAlteracao)
          .where(
            and(
              eq(schema.produtoAlteracao.produtoId, id),
              inArray(schema.produtoAlteracao.status, ['pendente', 'erro']),
            ),
          )
          .orderBy(desc(schema.produtoAlteracao.criadoEm))
          .limit(20)
      : [];

  // WIZARD: perguntas que os tamanhos deste produto disparam, com as opções.
  // A MESMA pergunta serve vários pratos — por isso o contador de uso, pra
  // ninguém renomear "ponto da carne" achando que mexe só na picanha.
  const codigosVar = variantesPdv.map((v) => v.codigo);
  const perguntasPdv =
    codigosVar.length > 0
      ? await db
          .select({
            varianteCodigo: schema.wizardProduto.codigoVarianteExterno,
            ordem: schema.wizardProduto.ordem,
            codigo: schema.wizardPergunta.codigoExterno,
            texto: schema.wizardPergunta.texto,
            min: schema.wizardPergunta.respostasMin,
            max: schema.wizardPergunta.respostasMax,
          })
          .from(schema.wizardProduto)
          .innerJoin(
            schema.wizardPergunta,
            and(
              eq(schema.wizardPergunta.filialId, produto.filialId),
              eq(schema.wizardPergunta.codigoExterno, schema.wizardProduto.codigoPergunta),
            ),
          )
          .where(and(
            eq(schema.wizardProduto.filialId, produto.filialId),
            inArray(schema.wizardProduto.codigoVarianteExterno, codigosVar),
          ))
          .orderBy(asc(schema.wizardProduto.ordem))
      : [];

  const codigosPergunta = [...new Set(perguntasPdv.map((x) => x.codigo))];
  const opcoesPdv =
    codigosPergunta.length > 0
      ? await db
          .select({
            codigo: schema.wizardOpcao.codigoExterno,
            codigoPergunta: schema.wizardOpcao.codigoPergunta,
            nome: schema.wizardOpcao.nome,
            precoPromo: schema.wizardOpcao.precoPromo,
            codigoVarianteExterno: schema.wizardOpcao.codigoVarianteExterno,
          })
          .from(schema.wizardOpcao)
          .where(and(
            eq(schema.wizardOpcao.filialId, produto.filialId),
            inArray(schema.wizardOpcao.codigoPergunta, codigosPergunta),
          ))
          .orderBy(asc(schema.wizardOpcao.nome))
      : [];

  const usoPergunta =
    codigosPergunta.length > 0
      ? await db
          .select({
            codigo: schema.wizardProduto.codigoPergunta,
            usos: sqlDrizzle<number>`count(distinct ${schema.wizardProduto.codigoVarianteExterno})::int`,
          })
          .from(schema.wizardProduto)
          .where(and(
            eq(schema.wizardProduto.filialId, produto.filialId),
            inArray(schema.wizardProduto.codigoPergunta, codigosPergunta),
          ))
          .groupBy(schema.wizardProduto.codigoPergunta)
      : [];

  // Complementos aceitos por cada tamanho (PRODUTODETALHECOMPLEMENTO).
  const compVar = aliasDrizzle(schema.produtoVariante, 'comp_var');
  const compProd = aliasDrizzle(schema.produto, 'comp_prod');
  const complementosPdv =
    codigosVar.length > 0
      ? await db
          .select({
            varianteCodigo: schema.produtoVarianteComplemento.codigoVarianteExterno,
            complementoCodigo: schema.produtoVarianteComplemento.codigoComplementoExterno,
            nome: compProd.nome,
            preco: compVar.precoVenda,
          })
          .from(schema.produtoVarianteComplemento)
          .leftJoin(
            compVar,
            and(
              eq(compVar.filialId, produto.filialId),
              eq(compVar.codigoExterno, schema.produtoVarianteComplemento.codigoComplementoExterno),
            ),
          )
          .leftJoin(compProd, eq(compProd.id, compVar.produtoId))
          .where(and(
            eq(schema.produtoVarianteComplemento.filialId, produto.filialId),
            inArray(schema.produtoVarianteComplemento.codigoVarianteExterno, codigosVar),
          ))
          .orderBy(asc(compProd.nome))
          .limit(300)
      : [];

  // FICHA DO PDV (PRODUTOFICHA): é ESTA que baixa estoque no Consumer, não a
  // ficha do Concilia da outra aba. Só leitura — mexer na composição pelo
  // Concilia sem a tela de conferência do PDV é pedir divergência de estoque.
  const insVar = aliasDrizzle(schema.produtoVariante, 'ing_var');
  const insProd = aliasDrizzle(schema.produto, 'ing_prod');
  const insumosPdv =
    codigosVar.length > 0
      ? await db
          .select({
            varianteCodigo: schema.produtoVarianteFicha.codigoVarianteExterno,
            ingredienteCodigo: schema.produtoVarianteFicha.codigoIngredienteExterno,
            quantidade: schema.produtoVarianteFicha.quantidade,
            nome: insProd.nome,
            unidade: insProd.unidadeEstoque,
          })
          .from(schema.produtoVarianteFicha)
          .leftJoin(
            insVar,
            and(
              eq(insVar.filialId, produto.filialId),
              eq(insVar.codigoExterno, schema.produtoVarianteFicha.codigoIngredienteExterno),
            ),
          )
          .leftJoin(insProd, eq(insProd.id, insVar.produtoId))
          .where(and(
            eq(schema.produtoVarianteFicha.filialId, produto.filialId),
            inArray(schema.produtoVarianteFicha.codigoVarianteExterno, codigosVar),
          ))
          .orderBy(asc(insProd.nome))
          .limit(200)
      : [];

  const hrefAba = (a: 'ficha' | 'fornecedores' | 'saldo' | 'marcas' | 'pdv') => {
    const qs = a === 'ficha' ? '' : `?aba=${a}`;
    return `/cadastros/produtos/${id}${qs}`;
  };

  // Carrega marcas aceitas + marcas disponiveis pra autocomplete
  const marcasAceitasRows = await db
    .select({
      id: schema.produtoMarcaAceita.id,
      marcaId: schema.marca.id,
      marcaNome: schema.marca.nome,
    })
    .from(schema.produtoMarcaAceita)
    .innerJoin(schema.marca, eq(schema.marca.id, schema.produtoMarcaAceita.marcaId))
    .where(eq(schema.produtoMarcaAceita.produtoId, id))
    .orderBy(asc(schema.marca.nome));

  const marcasDisponiveisRows = produto.filialId
    ? await db
        .select({
          id: schema.marca.id,
          nome: schema.marca.nome,
        })
        .from(schema.marca)
        .where(and(eq(schema.marca.filialId, produto.filialId), eq(schema.marca.ativa, true)))
        .orderBy(asc(schema.marca.nome))
    : [];

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <nav className="text-xs text-slate-500">
          <Link href="/cadastros/produtos" className="hover:text-slate-800">
            ← Produtos
          </Link>
        </nav>

        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {produto.nome ?? `#${produto.codigoExterno}`}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded px-1.5 py-0.5 font-medium ${badge.cls}`}>
                {badge.label}
              </span>
              <TrocarTipoButton produtoId={id} tipoAtual={produto.tipo} />
              <span className="text-slate-500">
                Unidade: <span className="font-mono">{produto.unidadeEstoque}</span>
              </span>
              {produto.codigoPersonalizado && (
                <span className="text-slate-500">
                  Código: <span className="font-mono">{produto.codigoPersonalizado}</span>
                </span>
              )}
              {produto.codigoExterno && (
                <span className="text-slate-400">
                  Consumer #{produto.codigoExterno}
                </span>
              )}
              {produto.criadoNaNuvem && (
                <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-500">
                  nuvem
                </span>
              )}
              {produto.descontinuado && (
                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-800">
                  Descontinuado
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 border-b border-slate-200">
          <div className="flex gap-1">
            <Link
              href={hrefAba('ficha')}
              className={`rounded-t-lg border-b-2 px-4 py-2 text-sm ${
                aba === 'ficha'
                  ? 'border-slate-900 font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Ficha técnica
              <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                {fichaRows.length}
              </span>
            </Link>
            <Link
              href={hrefAba('fornecedores')}
              className={`rounded-t-lg border-b-2 px-4 py-2 text-sm ${
                aba === 'fornecedores'
                  ? 'border-slate-900 font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Fornecedores
              <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                {fornecedoresRows.length}
              </span>
            </Link>
            {produto.controlaEstoque && (
              <Link
                href={hrefAba('saldo')}
                className={`rounded-t-lg border-b-2 px-4 py-2 text-sm ${
                  aba === 'saldo'
                    ? 'border-slate-900 font-medium text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Saldo & Custo
              </Link>
            )}
            {produto.codigoExterno != null && (
              <Link
                href={hrefAba('pdv')}
                className={`rounded-t-lg border-b-2 px-4 py-2 text-sm ${
                  aba === 'pdv'
                    ? 'border-slate-900 font-medium text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Cadastro no PDV
              </Link>
            )}
            <Link
              href={hrefAba('marcas')}
              className={`rounded-t-lg border-b-2 px-4 py-2 text-sm ${
                aba === 'marcas'
                  ? 'border-slate-900 font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Marcas aceitas
              <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                {marcasAceitasRows.length}
              </span>
            </Link>
          </div>
        </div>

        <div className="mt-6">
          {aba === 'pdv' ? (
            <AbaPdv
              produtoId={id}
              codigoExterno={produto.codigoExterno}
              nome={produto.nome}
              descricao={produto.descricao}
              precoCusto={produto.precoCusto}
              estoqueMinimo={produto.estoqueMinimo}
              estoqueControlado={produto.estoqueControlado}
              descontinuado={produto.descontinuado}
              codigoEtiqueta={produto.codigoEtiqueta}
              etiquetas={etiquetasPdv}
              variantes={variantesPdv.map((v) => ({
                codigo: v.codigo,
                tamanho: v.tamanho ?? null,
                precoVenda: v.precoVenda,
                pausado: v.dataPausado != null,
                comandaMobile: v.comandaMobile,
                cardapioDigital: v.cardapioDigital,
                codigoBarra: v.codigoBarra,
              }))}
              pendentes={pendentesPdv}
              perguntas={perguntasPdv.map((q) => ({
                varianteCodigo: q.varianteCodigo,
                codigo: q.codigo,
                texto: q.texto,
                min: q.min,
                max: q.max,
                usos: usoPergunta.find((u) => u.codigo === q.codigo)?.usos ?? 1,
                opcoes: opcoesPdv
                  .filter((o) => o.codigoPergunta === q.codigo)
                  .map((o) => ({
                    codigo: o.codigo,
                    nome: o.nome,
                    precoPromo: o.precoPromo,
                    lancaVariante: o.codigoVarianteExterno,
                  })),
              }))}
              insumos={insumosPdv.map((i) => ({
                varianteCodigo: i.varianteCodigo,
                codigo: i.ingredienteCodigo,
                nome: i.nome,
                quantidade: i.quantidade,
                unidade: i.unidade,
              }))}
              complementos={complementosPdv.map((c) => ({
                varianteCodigo: c.varianteCodigo,
                codigo: c.complementoCodigo,
                nome: c.nome,
                preco: c.preco,
              }))}
            />
          ) : aba === 'saldo' ? (
            <AbaSaldo
              produtoId={id}
              produtoNome={produto.nome ?? `#${produto.codigoExterno}`}
              unidadeEstoque={produto.unidadeEstoque}
              estoqueAtual={produto.estoqueAtual}
              estoqueMinimo={produto.estoqueMinimo}
              precoCusto={produto.precoCusto}
              movimentos={movimentos.map((m) => ({
                id: m.id,
                tipo: m.tipo,
                quantidade: m.quantidade,
                precoUnitario: m.precoUnitario,
                valorTotal: m.valorTotal,
                dataHora: m.dataHora ? m.dataHora.toISOString() : null,
                observacao: m.observacao,
                notaCompraItemId: m.notaCompraItemId,
                ordemProducaoId: m.ordemProducaoId,
                pedidoItemId: m.pedidoItemId,
              }))}
            />
          ) : aba === 'ficha' ? (
            <AbaFicha
              produtoId={id}
              produtoTipo={produto.tipo}
              linhas={fichaRows.map((r) => ({
                id: r.id,
                insumoId: r.insumoId,
                insumoNome: r.insumoNome ?? '',
                insumoTipo: r.insumoTipo,
                insumoUnidade: r.insumoUnidade,
                insumoControla: r.insumoControla,
                quantidade: r.quantidade,
                baixaEstoque: r.baixaEstoque,
                observacao: r.observacao,
              }))}
              usadoEm={usadoEmRows.map((r) => ({
                id: r.id,
                produtoId: r.produtoId,
                produtoNome: r.produtoNome ?? '',
                quantidade: r.quantidade,
              }))}
              insumosDisponiveis={insumosDisponiveis
                .filter((i) => i.id !== id)
                .map((i) => ({
                  id: i.id,
                  nome: i.nome ?? '(sem nome)',
                  tipo: i.tipo,
                  unidade: i.unidade,
                }))}
            />
          ) : aba === 'marcas' ? (
            <AbaMarcas
              produtoId={id}
              produtoNome={produto.nome ?? `#${produto.codigoExterno}`}
              marcasAceitas={marcasAceitasRows.map((m) => ({
                id: m.id,
                marcaId: m.marcaId,
                marcaNome: m.marcaNome,
              }))}
              marcasDisponiveis={marcasDisponiveisRows}
            />
          ) : (
            <AbaFornecedores
              produtoId={id}
              produtoUnidade={produto.unidadeEstoque}
              linhas={fornecedoresRows.map((r) => ({
                id: r.id,
                fornecedorId: r.fornecedorId,
                fornecedorNome: r.fornecedorNome ?? '',
                fornecedorCnpj: r.fornecedorCnpj,
                codigoFornecedor: r.codigoFornecedor,
                ean: r.ean,
                descricaoFornecedor: r.descricaoFornecedor,
                unidadeFornecedor: r.unidadeFornecedor,
                fatorConversao: r.fatorConversao,
                ultimoPrecoCusto: r.ultimoPrecoCusto,
                ultimoPrecoCustoUnidade: r.ultimoPrecoCustoUnidade,
                ultimaCompraEm: r.ultimaCompraEm ? r.ultimaCompraEm.toISOString() : null,
              }))}
              fornecedoresDisponiveis={fornecedoresDisponiveis.map((f) => ({
                id: f.id,
                nome: f.nome ?? '(sem nome)',
                cnpj: f.cnpjOuCpf,
              }))}
            />
          )}
        </div>
      </section>
    </main>
  );
}
