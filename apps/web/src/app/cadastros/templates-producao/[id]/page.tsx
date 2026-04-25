// Editor de template de OP: header (nome/desc/observação) + entradas + saídas
// pré-cadastradas. Ao concluir o cadastro, o template fica disponível pra
// criar OPs novas com 1 click via /movimento/producao.

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { TemplateEditor } from './editor';

export const dynamic = 'force-dynamic';

export default async function TemplateDetalhePage(props: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [tpl] = await db
    .select()
    .from(schema.templateOp)
    .where(eq(schema.templateOp.id, id))
    .limit(1);
  if (!tpl) notFound();

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, tpl.filialId),
      ),
    )
    .limit(1);
  if (!link) notFound();

  const entradas = await db
    .select({
      id: schema.templateOpEntrada.id,
      produtoId: schema.templateOpEntrada.produtoId,
      produtoNome: schema.produto.nome,
      produtoUnidade: schema.produto.unidadeEstoque,
      quantidadePadrao: schema.templateOpEntrada.quantidadePadrao,
    })
    .from(schema.templateOpEntrada)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.templateOpEntrada.produtoId))
    .where(eq(schema.templateOpEntrada.templateId, id))
    .orderBy(asc(schema.produto.nome));

  const saidas = await db
    .select({
      id: schema.templateOpSaida.id,
      tipo: schema.templateOpSaida.tipo,
      produtoId: schema.templateOpSaida.produtoId,
      produtoNome: schema.produto.nome,
      produtoUnidade: schema.produto.unidadeEstoque,
      quantidadePadrao: schema.templateOpSaida.quantidadePadrao,
      pesoRelativo: schema.templateOpSaida.pesoRelativo,
      observacao: schema.templateOpSaida.observacao,
    })
    .from(schema.templateOpSaida)
    .leftJoin(schema.produto, eq(schema.produto.id, schema.templateOpSaida.produtoId))
    .where(eq(schema.templateOpSaida.templateId, id))
    .orderBy(asc(schema.templateOpSaida.tipo), asc(schema.produto.nome));

  // Produtos disponíveis (mesmo filtro da OP)
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
        eq(schema.produto.filialId, tpl.filialId),
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

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-5xl px-6 py-10">
        <nav className="text-xs text-slate-500">
          <Link href="/cadastros/templates-producao" className="hover:text-slate-800">
            ← Templates de produção
          </Link>
        </nav>

        <TemplateEditor
          template={{
            id: tpl.id,
            nome: tpl.nome,
            descricaoPadrao: tpl.descricaoPadrao,
            observacao: tpl.observacao,
            ativo: tpl.ativo,
            vezesUsado: tpl.vezesUsado,
          }}
          entradas={entradas.map((e) => ({
            id: e.id,
            produtoId: e.produtoId,
            produtoNome: e.produtoNome ?? '(sem nome)',
            produtoUnidade: e.produtoUnidade,
            quantidadePadrao: e.quantidadePadrao,
          }))}
          saidas={saidas.map((s) => ({
            id: s.id,
            tipo: s.tipo,
            produtoId: s.produtoId,
            produtoNome: s.produtoNome,
            produtoUnidade: s.produtoUnidade,
            quantidadePadrao: s.quantidadePadrao,
            pesoRelativo: s.pesoRelativo,
            observacao: s.observacao,
          }))}
          produtosDisponiveis={produtosDisponiveis.map((p) => ({
            id: p.id,
            nome: p.nome ?? '(sem nome)',
            tipo: p.tipo,
            unidade: p.unidade,
            precoCusto: p.precoCusto,
          }))}
        />
      </section>
    </main>
  );
}
