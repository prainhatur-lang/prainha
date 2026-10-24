import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { diasAtrasBr, hojeBr } from '@/lib/datas';
import { ContabilEditor, type LinhaCategoria, type ContaContador } from './editor';

export const dynamic = 'force-dynamic';

/**
 * De-para com o plano de contas do contador (24/10/2026).
 * Cada categoria nossa (vinda do Consumer) ganha a conta contábil do escritório
 * ao lado — as categorias continuam iguais. Aqui ajusta e exporta.
 */
export default async function PlanoContabilPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'configuracao.read');
  const podeEditar = await podeUsuario(user.id, 'configuracao.editar');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const sel = await escolherFilial(filiais, sp.filialId);
  if (!sel) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = sel;

  const [orgRow] = await db
    .select({ organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filial.id));

  const [categorias, totais, plano] = await Promise.all([
    db
      .select({
        id: schema.categoriaConta.id,
        codigoExterno: schema.categoriaConta.codigoExterno,
        codigoPaiExterno: schema.categoriaConta.codigoPaiExterno,
        descricao: schema.categoriaConta.descricao,
        tipo: schema.categoriaConta.tipo,
        contaContabil: schema.categoriaConta.contaContabil,
        situacao: schema.categoriaConta.contaContabilSituacao,
        obs: schema.categoriaConta.contaContabilObs,
      })
      .from(schema.categoriaConta)
      .where(and(eq(schema.categoriaConta.filialId, filial.id), isNull(schema.categoriaConta.excluidaEm)))
      .orderBy(asc(schema.categoriaConta.codigoExterno)),
    db
      .select({
        categoriaId: schema.contaPagar.categoriaId,
        qtd: sql<number>`COUNT(*)::int`,
        pago: sql<string>`COALESCE(SUM(CASE WHEN ${schema.contaPagar.dataPagamento} IS NOT NULL THEN COALESCE(${schema.contaPagar.valorPago}, ${schema.contaPagar.valor}) ELSE 0 END), 0)::text`,
      })
      .from(schema.contaPagar)
      .where(and(eq(schema.contaPagar.filialId, filial.id), isNull(schema.contaPagar.dataDelete)))
      .groupBy(schema.contaPagar.categoriaId),
    orgRow
      ? db
          .select({
            classificacao: schema.planoContabil.classificacao,
            codigoReduzido: schema.planoContabil.codigoReduzido,
            nome: schema.planoContabil.nome,
            sintetica: schema.planoContabil.sintetica,
          })
          .from(schema.planoContabil)
          .where(eq(schema.planoContabil.organizacaoId, orgRow.organizacaoId))
          .orderBy(asc(schema.planoContabil.classificacao))
      : Promise.resolve([]),
  ]);

  const totMap = new Map(totais.map((t) => [t.categoriaId, t]));
  const descPorCodigo = new Map(categorias.map((c) => [c.codigoExterno, c.descricao]));
  const linhas: LinhaCategoria[] = categorias.map((c) => {
    const t = totMap.get(c.id);
    return {
      id: c.id,
      codigo: c.codigoExterno,
      descricao: c.descricao ?? `#${c.codigoExterno}`,
      grupo: c.codigoPaiExterno != null ? (descPorCodigo.get(c.codigoPaiExterno) ?? null) : null,
      tipo: c.tipo,
      contaContabil: c.contaContabil,
      situacao: c.situacao,
      obs: c.obs,
      qtd: Number(t?.qtd ?? 0),
      pago: Number(t?.pago ?? 0),
    };
  });
  const contas: ContaContador[] = plano.map((p) => ({
    classificacao: p.classificacao,
    reduzido: p.codigoReduzido,
    nome: p.nome,
    sintetica: p.sintetica,
  }));

  // Período padrão da exportação: mês anterior inteiro.
  const hoje = hojeBr();
  const [a, m] = hoje.split('-').map(Number);
  const mesAnt = m === 1 ? { a: a - 1, m: 12 } : { a, m: m - 1 };
  const de = `${mesAnt.a}-${String(mesAnt.m).padStart(2, '0')}-01`;
  const ate = diasAtrasBr(Number(hoje.slice(8, 10)));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-7xl px-6 py-10">
        <p className="text-xs text-slate-500">
          <Link href={`/cadastros/plano-contas?filialId=${filial.id}`} className="underline">
            Plano de contas
          </Link>{' '}
          › Conta do contador
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Plano de contas × contador</h1>
        <p className="mt-1 text-sm text-slate-600">
          Cada categoria da {filial.nome} com a conta contábil do escritório ao lado. As categorias não mudam — só a
          conta do contador.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/cadastros/plano-contas/contabil?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
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

        {contas.length === 0 ? (
          <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            O plano do contador ainda não foi carregado para esta organização.
          </p>
        ) : (
          <ContabilEditor
            filialId={filial.id}
            linhas={linhas}
            contas={contas}
            podeEditar={podeEditar}
            deInicial={de}
            ateInicial={ate}
          />
        )}
      </section>
    </main>
  );
}
