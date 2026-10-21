// /cotacao/[id]/respostas — matriz item × fornecedor com TODOS os valores
// respondidos, botão pra tirar um item da cotação de um fornecedor específico
// e "Colar resposta do WhatsApp" (IA interpreta o texto e o gestor confirma).

import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { db, schema } from '@concilia/db';
import { eq, asc, inArray, sql } from 'drizzle-orm';
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
      observacao: schema.cotacaoItem.observacao,
      produtoNome: schema.produto.nome,
      categoria: schema.produto.categoriaCompras,
      produtoId: schema.cotacaoItem.produtoId,
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
      observacao: schema.cotacaoFornecedor.observacao,
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

  // Últimas notas de cada item (dono 21/10/2026): "tem que ver nas últimas
  // notas o que tem, qual é o preço que está vindo, para ter uma média" — o
  // frango vem em caixa de ~20 kg e o gorgonzola em peça de ~3 kg, e a resposta
  // por kg não se compara com o pedido em cx/peça. Casa pelo produto ligado na
  // nota OU pelas 2 primeiras palavras do nome (sem acento), nas casas da
  // mesma organização, 180 dias. Só leitura, só pro gestor.
  const PARADAS = new Set(['com', 'sem', 'tipo', 'para', 'pra', 'und', 'unid', 'pct', 'cxa']);
  const alvoNota = sql`translate(lower(coalesce(it.descricao, '')), 'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;
  const notasPorItem: Record<
    string,
    Array<{ data: string; casa: string; fornecedor: string; descricao: string; unidade: string; qtd: number; vu: number; vt: number }>
  > = {};
  await Promise.all(
    itens.map(async (i) => {
      const palavras = (i.produtoNome ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !PARADAS.has(w))
        .slice(0, 2)
        .map((w) => w.slice(0, 5));
      const porNome =
        palavras.length === 0
          ? sql`FALSE`
          : palavras.map((w) => sql`${alvoNota} LIKE ${'%' + w + '%'}`).reduce((a, b) => sql`${a} AND ${b}`);
      const linhas = (await db.execute(sql`
        SELECT (n.data_emissao AT TIME ZONE 'America/Sao_Paulo')::date::text AS data,
               f.nome AS casa,
               COALESCE(n.emit_fantasia, n.emit_nome, '') AS fornecedor,
               COALESCE(it.descricao, '') AS descricao,
               COALESCE(it.unidade, '') AS unidade,
               it.quantidade::float AS qtd,
               it.valor_unitario::float AS vu,
               it.valor_total::float AS vt
        FROM nota_compra_item it
        JOIN nota_compra n ON n.id = it.nota_compra_id
        JOIN filial f ON f.id = it.filial_id
        WHERE f.organizacao_id = (SELECT organizacao_id FROM filial WHERE id = ${c.filialId})
          AND n.data_emissao > now() - interval '180 days'
          AND (it.produto_id = ${i.produtoId} OR (${porNome}))
        ORDER BY n.data_emissao DESC
        LIMIT 12
      `)) as unknown as Array<{ data: string; casa: string; fornecedor: string; descricao: string; unidade: string; qtd: number | null; vu: number | null; vt: number | null }>;
      // Mesma linha repetida (nota importada 2x / item lançado 2x) aparece uma vez só
      const vistas = new Set<string>();
      const unicas = linhas
        .filter((l) => {
          const k = `${l.data}|${l.fornecedor}|${l.descricao.toLowerCase()}|${l.qtd}|${l.vt}`;
          if (vistas.has(k)) return false;
          vistas.add(k);
          return true;
        })
        .slice(0, 6);
      if (unicas.length)
        notasPorItem[i.id] = unicas.map((l) => ({
          ...l,
          qtd: Number(l.qtd ?? 0),
          vu: Number(l.vu ?? 0),
          vt: Number(l.vt ?? 0),
        }));
    }),
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
            observacao: i.observacao,
          }))}
          fornecedores={fornecedores.map((f) => ({
            cfId: f.cfId,
            nome: f.nome ?? '?',
            status: f.status,
            respondidoEm: f.respondidoEm ? formatDateTime(f.respondidoEm) : null,
            linkAbertoEm: f.linkAbertoEm ? formatDateTime(f.linkAbertoEm) : null,
            frete: f.observacao,
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
          notasPorItem={notasPorItem}
        />
      </div>
    </main>
  );
}
