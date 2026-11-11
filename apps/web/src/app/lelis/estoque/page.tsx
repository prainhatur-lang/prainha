// Lelis — estoque disponível, numa tela só pra isso (11/11/2026, dono: a
// /lelis/precos "não ajuda muito pra ver"). Só consulta: produto, saldo, custo
// e preço pra empresa. O saldo é o mesmo da /lelis/vender e da aba "Estoque e
// tributação" (soma de revenda_movimento); nada é gravado aqui.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { db, schema } from '@concilia/db';
import { asc, eq, sql } from 'drizzle-orm';
import { ehAdmin } from '@/lib/usuario-admin';
import { lelisFilialId } from '@/lib/lelis/sincronizar';
import { calcularDestinos, calcularPreco } from '@/lib/lelis/preco';
import { EstoqueLelis, type ProdutoEstoque } from './lista';

export const dynamic = 'force-dynamic';

const num = (x: string | null) => (x == null ? null : Number(x));

export default async function EstoqueLelisPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!(await ehAdmin(user.id))) redirect('/');

  const filialId = await lelisFilialId();
  if (!filialId) redirect('/lelis/precos');

  const [cfg] = await db.select().from(schema.revendaConfig).where(eq(schema.revendaConfig.filialId, filialId)).limit(1);
  const pctOperacional = cfg ? Number(cfg.pctOperacional) : 10;
  const pctMargem = cfg ? Number(cfg.pctMargem) : 15;
  const pctImpostosVenda = cfg ? Number(cfg.pctImpostosVenda) : 0;
  const fiscal = cfg?.fiscal ?? {};
  const pctPcPadrao = (fiscal.cstPis ?? '01') === '01' ? (fiscal.aliqPis ?? 1.65) + (fiscal.aliqCofins ?? 7.6) : 0;
  const pctIcmsCF = fiscal.icmsConsumidorFinal ?? 20;

  const produtos = await db
    .select({
      p: schema.revendaProduto,
      saldo: sql<number>`coalesce((SELECT sum(m.quantidade) FROM revenda_movimento m WHERE m.revenda_produto_id = revenda_produto.id), 0)::float`,
    })
    .from(schema.revendaProduto)
    .where(eq(schema.revendaProduto.filialId, filialId))
    .orderBy(asc(schema.revendaProduto.descricao));

  const lista: ProdutoEstoque[] = produtos
    .filter(({ p, saldo }) => p.ativo || Number(saldo) !== 0)
    .map(({ p, saldo }) => {
      const base = {
        custoUnit: Number(p.custoUnit),
        pctIpi: Number(p.pctIpi),
        aliqOrigem: num(p.aliqOrigem),
        pctCarga: num(p.pctCarga),
        cargaComIpi: p.cargaComIpi,
        freteUnit: Number(p.freteUnit),
        pctOperacional: num(p.pctOperacional) ?? pctOperacional,
        pctMargem: num(p.pctMargem) ?? pctMargem,
        precoManual: num(p.precoManual),
      };
      const tabela = calcularPreco({ ...base, pctImpostosVenda: num(p.pctImpostosVenda) ?? pctImpostosVenda });
      const empresa = calcularDestinos(
        { ...base, pctImpostosVenda: 0 },
        { pctPisCofins: p.cstPisSaida && p.cstPisSaida !== '01' ? 0 : pctPcPadrao, pctIcmsConsumidor: pctIcmsCF },
      ).empresa.preco;
      return {
        id: p.id,
        descricao: p.descricao,
        ean: p.ean,
        fornecedor: p.fornecedorNome,
        unidade: p.unidade,
        saldo: Number(saldo),
        custo: tabela.custo,
        preco: empresa ?? tabela.preco ?? null,
      };
    });

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">🍷 Lelis — estoque disponível</h1>
            <p className="mt-1 text-sm text-slate-500">
              O que tem hoje na Lelis, produto por produto. Entra pelo “Dar entrada” da nota de compra e sai pela venda.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/lelis/inventario" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Fazer inventário →
            </Link>
            <Link href="/lelis/vender" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Vender pras casas →
            </Link>
            <Link href="/lelis/precos" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Preços e notas →
            </Link>
          </div>
        </div>
        <EstoqueLelis produtos={lista} />
      </div>
    </main>
  );
}
