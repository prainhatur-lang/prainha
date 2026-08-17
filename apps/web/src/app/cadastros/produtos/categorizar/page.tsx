// Atribui categoria_compras em batch a produtos (INSUMO/VENDA_SIMPLES) que
// vieram do Consumer mas ainda nao entram no fluxo de cotacao.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq, isNull, isNotNull, sql, inArray } from 'drizzle-orm';
import { buscaIlike } from '@/lib/texto';
import { AppHeader } from '@/components/app-header';
import { CategorizarForm } from './form';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  q?: string;
  status?: string; // 'sem' | 'com' | ''
  tipo?: string;
  page?: string;
  mov?: string; // '1' = só quem movimentou estoque nos últimos 90 dias
}

/** Janela pra considerar que o produto "está vivo" no estoque. */
const DIAS_MOVIMENTO = 90;

const PAGE_SIZE = 100;

const CATEGORIAS = [
  'Confeitaria',
  'Estoque seco',
  'Hortifruti',
  'Limpeza',
  'Proteína',
  'Refrigeração',
  'Utensílios',
  'Bebidas - Refrigerantes',
  'Bebidas - Cervejas',
  'Bebidas - Destilados',
  'Bebidas - Vinhos',
];

export default async function CategorizarPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ?? filiais[0] ?? null;
  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const q = (sp.q ?? '').trim();
  const statusFiltro = sp.status === 'com' ? 'com' : 'sem'; // default: sem categoria
  const tipoFiltro = (sp.tipo ?? '').trim();
  const page = Math.max(0, Number(sp.page ?? '0') || 0);
  const soMovimenta = sp.mov === '1';

  // Produto "vivo": teve movimento de estoque na janela. É por onde vale a pena
  // começar a categorizar — sem categoria de compras ele não entra na sugestão
  // nem na cotação, por mais que venda todo dia.
  const movimentouNaJanela = sql`EXISTS (
    SELECT 1 FROM movimento_estoque m
    WHERE m.produto_id = ${schema.produto.id}
      AND m.filial_id = ${filial.id}
      AND m.data_hora >= now() - interval '${sql.raw(String(DIAS_MOVIMENTO))} days'
  )`;

  const where = and(
    eq(schema.produto.filialId, filial.id),
    eq(schema.produto.controlaEstoque, true),
    inArray(schema.produto.tipo, ['INSUMO', 'VENDA_SIMPLES']),
    sql`COALESCE(${schema.produto.descontinuado}, false) = false`,
    statusFiltro === 'sem'
      ? isNull(schema.produto.categoriaCompras)
      : isNotNull(schema.produto.categoriaCompras),
    tipoFiltro ? eq(schema.produto.tipo, tipoFiltro) : undefined,
    q ? buscaIlike(schema.produto.nome, q) : undefined,
    soMovimenta ? movimentouNaJanela : undefined,
  );

  // Quantos ainda estão fora do fluxo de compras mesmo movimentando estoque.
  const [{ qtdMov }] = await db
    .select({ qtdMov: sql<number>`count(*)::int` })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filial.id),
        eq(schema.produto.controlaEstoque, true),
        inArray(schema.produto.tipo, ['INSUMO', 'VENDA_SIMPLES']),
        sql`COALESCE(${schema.produto.descontinuado}, false) = false`,
        isNull(schema.produto.categoriaCompras),
        movimentouNaJanela,
      ),
    );

  const [{ qtd }] = await db
    .select({ qtd: sql<number>`count(*)::int` })
    .from(schema.produto)
    .where(where);

  const produtos = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      tipo: schema.produto.tipo,
      categoria: schema.produto.categoriaCompras,
      unidade: schema.produto.unidadeEstoque,
      codigoExterno: schema.produto.codigoExterno,
      criadoNaNuvem: schema.produto.criadoNaNuvem,
    })
    .from(schema.produto)
    .where(where)
    .orderBy(
      // Filtrando por movimento, os mais recentes primeiro (o que gira mais).
      soMovimenta
        ? sql`(SELECT max(m.data_hora) FROM movimento_estoque m
               WHERE m.produto_id = ${schema.produto.id} AND m.filial_id = ${filial.id})
              DESC NULLS LAST`
        : asc(schema.produto.nome),
    )
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  // Cross-filial: pra cada nome de produto na pagina, busca a categoria_compras
  // de produtos com mesmo nome em outras filiais da mesma org (que ja foram
  // categorizados). Vira a sugestao prioritaria (mais confiavel que keyword).
  const nomesCanonicos = produtos
    .map((p) => (p.nome ?? '').toLowerCase().trim())
    .filter(Boolean);
  const crossFilialMap: Record<string, string> = {};
  if (nomesCanonicos.length > 0) {
    const [filialAlvo] = await db
      .select({ organizacaoId: schema.filial.organizacaoId })
      .from(schema.filial)
      .where(eq(schema.filial.id, filial.id))
      .limit(1);
    if (filialAlvo?.organizacaoId) {
      const crossRows = await db
        .select({
          nome: schema.produto.nome,
          categoria: schema.produto.categoriaCompras,
        })
        .from(schema.produto)
        .innerJoin(schema.filial, eq(schema.filial.id, schema.produto.filialId))
        .where(
          and(
            eq(schema.filial.organizacaoId, filialAlvo.organizacaoId),
            // outras filiais (nao a alvo)
            sql`${schema.produto.filialId} != ${filial.id}`,
            isNotNull(schema.produto.categoriaCompras),
            sql`lower(trim(${schema.produto.nome})) = ANY(${nomesCanonicos}::text[])`,
          ),
        );
      for (const r of crossRows) {
        const k = (r.nome ?? '').toLowerCase().trim();
        if (k && r.categoria) crossFilialMap[k] = r.categoria;
      }
    }
  }

  const totalPag = Math.max(1, Math.ceil(Number(qtd) / PAGE_SIZE));

  function hrefPag(p: number) {
    const qs = new URLSearchParams();
    qs.set('filialId', filial.id);
    if (q) qs.set('q', q);
    qs.set('status', statusFiltro);
    if (tipoFiltro) qs.set('tipo', tipoFiltro);
    if (soMovimenta) qs.set('mov', '1');
    if (p > 0) qs.set('page', String(p));
    return `/cadastros/produtos/categorizar?${qs.toString()}`;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Categorizar produtos do Consumer</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Atribua <code>categoria_compras</code> aos insumos/produtos sincronizados do Consumer
            pra eles entrarem no fluxo de cotação. Replica automaticamente em filiais irmãs (por
            nome).
          </p>
        </div>

        {/* Filtros */}
        <form className="mb-4 flex flex-wrap items-end gap-2 text-xs">
          <input type="hidden" name="filialId" value={filial.id} />
          {filiais.length > 1 && (
            <div className="flex gap-1">
              {filiais.map((f) => (
                <Link
                  key={f.id}
                  href={`/cadastros/produtos/categorizar?filialId=${f.id}&status=${statusFiltro}`}
                  className={`rounded-md border px-2 py-1 ${
                    f.id === filial.id
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {f.nome}
                </Link>
              ))}
            </div>
          )}
          <label>
            Status
            <select
              name="status"
              defaultValue={statusFiltro}
              className="ml-2 rounded border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="sem">Sem categoria (default)</option>
              <option value="com">Com categoria</option>
            </select>
          </label>
          <label>
            Tipo
            <select
              name="tipo"
              defaultValue={tipoFiltro}
              className="ml-2 rounded border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="">Insumo + Produto</option>
              <option value="INSUMO">Só Insumos</option>
              <option value="VENDA_SIMPLES">Só Produtos (revenda)</option>
            </select>
          </label>
          <label>
            Busca
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="nome..."
              className="ml-2 rounded border border-slate-300 px-2 py-1 text-xs"
            />
          </label>
          <label className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1">
            <input type="checkbox" name="mov" value="1" defaultChecked={soMovimenta} />
            Só quem movimentou estoque ({DIAS_MOVIMENTO}d)
          </label>
          <button
            type="submit"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50"
          >
            Filtrar
          </button>
        </form>

        {qtdMov > 0 && !soMovimenta && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <b>{qtdMov} produto(s)</b> movimentaram estoque nos últimos {DIAS_MOVIMENTO} dias e ainda
            estão <b>sem categoria de compras</b> — ou seja, não aparecem na sugestão de compra nem
            na cotação, por mais que girem.{' '}
            <Link
              href={`/cadastros/produtos/categorizar?filialId=${filial.id}&status=sem&mov=1`}
              className="font-medium underline"
            >
              Categorizar esses primeiro →
            </Link>
          </div>
        )}

        <div className="mb-3 text-xs text-slate-500">
          {qtd} produtos · página {page + 1}/{totalPag} · mostrando {produtos.length}
          {soMovimenta && ' · só quem movimentou estoque, mais recentes primeiro'}
        </div>

        <CategorizarForm
          produtos={produtos.map((p) => ({
            id: p.id,
            nome: p.nome ?? '(sem nome)',
            tipo: p.tipo,
            categoria: p.categoria,
            unidade: p.unidade,
            codigoExterno: p.codigoExterno,
            criadoNaNuvem: p.criadoNaNuvem,
            categoriaCrossfilial:
              crossFilialMap[(p.nome ?? '').toLowerCase().trim()] ?? null,
          }))}
          categorias={CATEGORIAS}
        />

        {totalPag > 1 && (
          <div className="mt-4 flex items-center justify-between">
            {page > 0 ? (
              <Link
                href={hrefPag(page - 1)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                ← Anterior
              </Link>
            ) : (
              <span />
            )}
            {page < totalPag - 1 ? (
              <Link
                href={hrefPag(page + 1)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                Próxima →
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
