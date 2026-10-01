// Nova transferência entre casas. Avulsa (escolhe os produtos do estoque) ou
// a partir de uma nota lançada (?notaId=… já traz os itens que entraram).
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { estimarCustos } from '@/lib/transferencia';
import { NovaTransferenciaForm, type ProdOpc, type ItemInicial } from './form';

export const dynamic = 'force-dynamic';

/** Filial de teste fica fora da lista de destino */
const CNPJ_TESTE = '00000000000000';

export default async function NovaTransferenciaPage(props: {
  searchParams: Promise<{ filialId?: string; notaId?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'nota_compra.lancar_estoque');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const notaId = sp.notaId && /^[0-9a-f-]{36}$/i.test(sp.notaId) ? sp.notaId : null;

  // Vindo de uma nota: a origem é a casa da nota
  let nota: { id: string; filialId: string; numero: string | null; fornecedor: string | null } | null = null;
  if (notaId) {
    const [n] = await db
      .select({
        id: schema.notaCompra.id,
        filialId: schema.notaCompra.filialId,
        numero: sql<string | null>`${schema.notaCompra.numero}::text`,
        fornecedor: schema.fornecedor.nome,
      })
      .from(schema.notaCompra)
      .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.notaCompra.fornecedorId))
      .where(eq(schema.notaCompra.id, notaId))
      .limit(1);
    if (n && filiais.some((f) => f.id === n.filialId)) nota = n;
  }

  const sel = await escolherFilial(filiais, nota?.filialId ?? sp.filialId);
  if (!sel) redirect('/movimento/transferencias');
  const origem = sel;
  // Casas que recebem: as que o usuário acessa + as outras da mesma
  // organização (pra essas só dá pra ENVIAR — quem recebe confere e dá entrada).
  const [orgOrigem] = await db
    .select({ org: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, origem.id))
    .limit(1);
  const daOrg = orgOrigem
    ? await db
        .select({ id: schema.filial.id, nome: schema.filial.nome, cnpj: schema.filial.cnpj })
        .from(schema.filial)
        .where(eq(schema.filial.organizacaoId, orgOrigem.org))
        .orderBy(asc(schema.filial.cnpj))
    : [];
  const destinos: Array<{ id: string; nome: string; semAcesso: boolean }> = [
    ...filiais
      .filter((f) => f.id !== origem.id && f.cnpj !== CNPJ_TESTE)
      .map((f) => ({ id: f.id, nome: f.nome, semAcesso: false })),
    ...daOrg
      .filter((f) => f.id !== origem.id && f.cnpj !== CNPJ_TESTE && !filiais.some((x) => x.id === f.id))
      .map((f) => ({ id: f.id, nome: f.nome, semAcesso: true })),
  ];

  const cols = {
    id: schema.produto.id,
    filialId: schema.produto.filialId,
    nome: schema.produto.nome,
    unidade: schema.produto.unidadeEstoque,
    custo: schema.produto.precoCusto,
    saldo: schema.produto.estoqueAtual,
    descontinuado: schema.produto.descontinuado,
  };
  const prods = await db
    .select(cols)
    .from(schema.produto)
    .where(
      and(
        inArray(schema.produto.filialId, [origem.id, ...destinos.map((d) => d.id)]),
        eq(schema.produto.controlaEstoque, true),
        isNotNull(schema.produto.nome),
      ),
    )
    .orderBy(asc(schema.produto.nome));
  const toOpc = (p: (typeof prods)[number]): ProdOpc => ({
    id: p.id,
    nome: p.nome ?? '',
    unidade: p.unidade,
    custo: Number(p.custo ?? 0),
    saldo: Number(p.saldo ?? 0),
    inativo: p.descontinuado === true,
  });
  // Produto da origem sem custo médio: já leva um custo estimado pra tela
  const estimados = await estimarCustos(origem.id);
  const produtosOrigem = prods
    .filter((p) => p.filialId === origem.id)
    .map(toOpc)
    .map((p) => {
      const e = p.custo > 0 ? undefined : estimados.get(p.id);
      return e ? { ...p, custoEstimado: e.custo, fonteEstimativa: e.fonte } : p;
    });
  const produtosDestino: Record<string, ProdOpc[]> = {};
  for (const d of destinos) produtosDestino[d.id] = prods.filter((p) => p.filialId === d.id).map(toOpc);

  // De/para salvo (produto da origem → produto em cada casa que recebe)
  const depara: Record<string, Record<string, string>> = {};
  if (destinos.length && produtosOrigem.length) {
    const rows = await db
      .select({
        o: schema.produtoDeparaFilial.produtoOrigemId,
        f: schema.produtoDeparaFilial.filialDestinoId,
        d: schema.produtoDeparaFilial.produtoDestinoId,
      })
      .from(schema.produtoDeparaFilial)
      .innerJoin(schema.produto, eq(schema.produto.id, schema.produtoDeparaFilial.produtoOrigemId))
      .where(
        and(
          eq(schema.produto.filialId, origem.id),
          inArray(schema.produtoDeparaFilial.filialDestinoId, destinos.map((d) => d.id)),
        ),
      );
    for (const r of rows) (depara[r.f] ??= {})[r.o] = r.d;
  }

  // Itens que a nota colocou no estoque (movimentos ENTRADA_COMPRA, já na
  // unidade do produto)
  let itensIniciais: ItemInicial[] = [];
  if (nota) {
    const rows = await db
      .select({
        produtoId: schema.movimentoEstoque.produtoId,
        qtd: sql<string>`SUM(${schema.movimentoEstoque.quantidade})::text`,
      })
      .from(schema.movimentoEstoque)
      .innerJoin(schema.notaCompraItem, eq(schema.notaCompraItem.id, schema.movimentoEstoque.notaCompraItemId))
      .where(
        and(
          eq(schema.notaCompraItem.notaCompraId, nota.id),
          eq(schema.movimentoEstoque.filialId, origem.id),
        ),
      )
      .groupBy(schema.movimentoEstoque.produtoId);
    itensIniciais = rows
      .filter((r) => Number(r.qtd) > 0)
      .map((r) => ({ produtoOrigemId: r.produtoId, quantidade: Number(r.qtd) }));
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Link href="/movimento/transferencias" className="text-sm text-sky-700 hover:underline">
          ← Transferências
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Nova transferência</h1>
        <p className="mt-1 text-sm text-slate-600">
          Sai do estoque de <b>{origem.nome}</b> pelo custo médio. A casa que recebe confere a mercadoria
          e aí ela entra no estoque de lá, com uma conta a pagar pra {origem.nome}, compensada no encontro
          de contas do mês. É uma transferência simples (só financeiro); a nota fiscal é opcional.
        </p>
        {nota && (
          <p className="mt-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800">
            A partir da nota {nota.numero ?? ''} {nota.fornecedor ? `— ${nota.fornecedor}` : ''}: {itensIniciais.length} item(ns)
            que entraram no estoque. Ajuste as quantidades se só parte vai pra outra casa.
          </p>
        )}

        {!nota && filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Casa que envia:</span>
            {filiais
              .filter((f) => f.cnpj !== CNPJ_TESTE || f.id === origem.id)
              .map((f) => (
                <Link
                  key={f.id}
                  href={`/movimento/transferencias/nova?filialId=${f.id}`}
                  className={`rounded-md border px-3 py-1 text-xs ${
                    f.id === origem.id
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {f.nome}
                </Link>
              ))}
          </div>
        )}

        {destinos.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500">Não há outra casa pra receber.</p>
        ) : (
          <NovaTransferenciaForm
            origemId={origem.id}
            destinos={destinos}
            origemNome={origem.nome}
            produtosOrigem={produtosOrigem}
            produtosDestino={produtosDestino}
            depara={depara}
            itensIniciais={itensIniciais}
            notaCompraId={nota?.id ?? null}
            hoje={hojeBr()}
          />
        )}
      </section>
    </main>
  );
}
