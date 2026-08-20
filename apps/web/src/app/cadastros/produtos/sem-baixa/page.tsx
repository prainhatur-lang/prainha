// VENDEU E NÃO BAIXOU NADA.
//
// Produto que sai no PDV mas não tem receita nem controle de estoque próprio:
// a venda não consome nada em lugar nenhum. Era invisível — só apareceu quando
// fomos conferir por que 700 insumos tinham saldo parado. São 97 produtos e
// quase 3.000 itens em 30 dias na Prainha (sachê, suco de jarra, molhos).
//
// COUVERT e serviços aparecem aqui e é legítimo: não consomem mesmo. Por isso
// a tela não conserta nada sozinha — quem marca é a casa.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { ListaSemBaixa } from './lista';

export const dynamic = 'force-dynamic';

const DIAS = 30;

export default async function SemBaixaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'produto.read');

  const filiais = await filiaisDoUsuario(user.id);
  const ids = filiais.map((f) => f.id);
  const nomeFilial = new Map(filiais.map((f) => [f.id, f.nome]));

  const desde = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000);

  const linhas = ids.length
    ? await db
        .select({
          id: schema.produto.id,
          nome: schema.produto.nome,
          filialId: schema.produto.filialId,
          vendas: sql<number>`count(*)::int`,
          quantidade: sql<string>`COALESCE(sum(${schema.pedidoItem.quantidade}), 0)::text`,
        })
        .from(schema.pedidoItem)
        .innerJoin(schema.produto, eq(schema.produto.id, schema.pedidoItem.produtoId))
        .where(
          and(
            inArray(schema.pedidoItem.filialId, ids),
            isNull(schema.pedidoItem.dataDelete),
            gte(schema.pedidoItem.dataHoraCadastro, desde),
            eq(schema.produto.controlaEstoque, false),
            notExists(
              db
                .select({ x: sql`1` })
                .from(schema.fichaTecnica)
                .where(eq(schema.fichaTecnica.produtoId, schema.produto.id)),
            ),
          ),
        )
        .groupBy(schema.produto.id, schema.produto.nome, schema.produto.filialId)
        .orderBy(desc(sql`count(*)`))
        .limit(300)
    : [];

  const totalItens = linhas.reduce((s, l) => s + Number(l.vendas), 0);

  return (
    <>
      <AppHeader userEmail={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <nav className="text-xs text-slate-500">
          <Link href="/cadastros/produtos" className="hover:underline">Produtos</Link>
          <span className="mx-1">/</span>
          <span>Vendeu sem baixar</span>
        </nav>

        <h1 className="mt-2 text-2xl font-bold text-slate-900">Vendeu e não baixou nada</h1>
        <p className="mt-1 text-sm text-slate-600">
          Últimos {DIAS} dias · <b>{linhas.length}</b> produtos · <b>{totalItens}</b> itens vendidos.
          Nenhum deles tem receita nem controle de estoque próprio — a venda não consome nada.
        </p>
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Nem todo item aqui é erro: <b>couvert e serviços</b> não consomem estoque mesmo. Marque só o
          que a casa realmente controla. Produto que sai de uma receita (molho, suco de jarra) fica
          melhor com <b>ficha técnica</b> do que com estoque próprio — aí quem baixa é o insumo.
        </p>

        <div className="mt-5">
          <ListaSemBaixa
            linhas={linhas.map((l) => ({
              id: l.id,
              nome: l.nome,
              filial: nomeFilial.get(l.filialId) ?? '—',
              vendas: Number(l.vendas),
              quantidade: l.quantidade,
              temFicha: false,
            }))}
          />
        </div>
      </main>
    </>
  );
}
