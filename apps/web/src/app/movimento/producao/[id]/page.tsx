import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { EditorProducao } from './editor';

export const dynamic = 'force-dynamic';

const BADGE_STATUS: Record<string, { label: string; cls: string }> = {
  RASCUNHO: { label: 'Rascunho', cls: 'bg-amber-100 text-amber-800' },
  CONCLUIDA: { label: 'Concluída', cls: 'bg-emerald-100 text-emerald-800' },
  CANCELADA: { label: 'Cancelada', cls: 'bg-rose-100 text-rose-800' },
};

export default async function OpDetalhePage(props: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [op] = await db
    .select()
    .from(schema.ordemProducao)
    .where(eq(schema.ordemProducao.id, id))
    .limit(1);
  if (!op) notFound();

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, op.filialId),
      ),
    )
    .limit(1);
  if (!link) notFound();

  const entradas = await db
    .select({
      id: schema.ordemProducaoEntrada.id,
      produtoId: schema.ordemProducaoEntrada.produtoId,
      produtoNome: schema.produto.nome,
      produtoUnidade: schema.produto.unidadeEstoque,
      quantidade: schema.ordemProducaoEntrada.quantidade,
      precoUnitario: schema.ordemProducaoEntrada.precoUnitario,
      valorTotal: schema.ordemProducaoEntrada.valorTotal,
    })
    .from(schema.ordemProducaoEntrada)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.ordemProducaoEntrada.produtoId))
    .where(eq(schema.ordemProducaoEntrada.ordemProducaoId, id))
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
      custoRateado: schema.ordemProducaoSaida.custoRateado,
      valorTotal: schema.ordemProducaoSaida.valorTotal,
      observacao: schema.ordemProducaoSaida.observacao,
    })
    .from(schema.ordemProducaoSaida)
    .leftJoin(schema.produto, eq(schema.produto.id, schema.ordemProducaoSaida.produtoId))
    .where(eq(schema.ordemProducaoSaida.ordemProducaoId, id))
    .orderBy(asc(schema.ordemProducaoSaida.tipo), asc(schema.produto.nome));

  // Fotos que o cozinheiro enviou
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

  // Colaboradores ativos (cozinheiros) pra autocomplete do responsável
  const colaboradores = await db
    .select({
      id: schema.colaborador.id,
      nome: schema.colaborador.nome,
    })
    .from(schema.colaborador)
    .where(
      and(
        eq(schema.colaborador.filialId, op.filialId),
        eq(schema.colaborador.ativo, true),
        eq(schema.colaborador.tipo, 'COZINHA'),
      ),
    )
    .orderBy(asc(schema.colaborador.nome));

  // Produtos disponíveis pra OP: insumos e revenda controlando estoque, ativos
  // (não descontinuados nem pausados). Exclui SERVICO/VARIANTE/COMBO porque
  // não fazem sentido em transformação.
  const produtosDisponiveis = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      tipo: schema.produto.tipo,
      unidade: schema.produto.unidadeEstoque,
      precoCusto: schema.produto.precoCusto,
    })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, op.filialId),
        eq(schema.produto.controlaEstoque, true),
        inArray(schema.produto.tipo, ['INSUMO', 'VENDA_SIMPLES', 'COMPLEMENTO']),
        or(
          isNull(schema.produto.descontinuado),
          eq(schema.produto.descontinuado, false),
        ),
        isNull(schema.produto.dataPausado),
      ),
    )
    .orderBy(sql`${schema.produto.tipo} = 'INSUMO' DESC`, asc(schema.produto.nome))
    .limit(5000);

  const badge = BADGE_STATUS[op.status] ?? { label: op.status, cls: 'bg-slate-100' };

  return (
    <main className="min-h-screen bg-slate-50 print:bg-white">
      <div className="print:hidden">
        <AppHeader userEmail={user.email} />
      </div>

      <section className="mx-auto max-w-6xl px-6 py-10 print:py-4">
        <nav className="text-xs text-slate-500 print:hidden">
          <Link href="/movimento/producao" className="hover:text-slate-800">
            ← Ordens de produção
          </Link>
        </nav>

        <EditorProducao
          op={{
            id: op.id,
            descricao: op.descricao,
            responsavel: op.responsavel,
            observacao: op.observacao,
            status: op.status,
            dataHora: op.dataHora ? op.dataHora.toISOString() : null,
            concluidaEm: op.concluidaEm ? op.concluidaEm.toISOString() : null,
            custoTotalEntradas: op.custoTotalEntradas,
            divergenciaPercentual: op.divergenciaPercentual,
            enviadaEm: op.enviadaEm ? op.enviadaEm.toISOString() : null,
            marcadaProntaEm: op.marcadaProntaEm ? op.marcadaProntaEm.toISOString() : null,
            marcadaProntaPor: op.marcadaProntaPor,
          }}
          badge={badge}
          entradas={entradas.map((e) => ({
            id: e.id,
            produtoId: e.produtoId,
            produtoNome: e.produtoNome ?? '(sem nome)',
            produtoUnidade: e.produtoUnidade,
            quantidade: e.quantidade,
            precoUnitario: e.precoUnitario,
            valorTotal: e.valorTotal,
          }))}
          saidas={saidas.map((s) => ({
            id: s.id,
            tipo: s.tipo,
            produtoId: s.produtoId,
            produtoNome: s.produtoNome,
            produtoUnidade: s.produtoUnidade,
            quantidade: s.quantidade,
            pesoRelativo: s.pesoRelativo,
            custoRateado: s.custoRateado,
            valorTotal: s.valorTotal,
            observacao: s.observacao,
          }))}
          produtosDisponiveis={produtosDisponiveis.map((p) => ({
            id: p.id,
            nome: p.nome ?? '(sem nome)',
            tipo: p.tipo,
            unidade: p.unidade,
            precoCusto: p.precoCusto,
          }))}
          colaboradores={colaboradores.map((c) => c.nome)}
          filialId={op.filialId}
          fotos={fotos.map((f) => ({
            id: f.id,
            tipo: f.tipo,
            url: f.url,
            observacao: f.observacao,
            enviadaEm: f.enviadaEm ? f.enviadaEm.toISOString() : null,
          }))}
        />
      </section>
    </main>
  );
}
