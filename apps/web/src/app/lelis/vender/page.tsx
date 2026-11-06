// Lelis — tela de VENDA pras casas (06/11/2026, dono: "uma coisa mais prática pra vender").
// Escolhe a casa, busca o produto, põe a quantidade e manda sem nota.
// Grava pelo mesmo POST /api/lelis/pedido da /lelis/precos (mesma regra: baixa o
// estoque da Lelis, a receber aqui, conta a pagar na casa; a casa confere e dá entrada).
// Preço = "pra empresa" calculado igual à /lelis/precos (lib/lelis/preco.ts).

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { db, schema } from '@concilia/db';
import { asc, eq, sql } from 'drizzle-orm';
import { ehAdmin } from '@/lib/usuario-admin';
import { lelisFilialId } from '@/lib/lelis/sincronizar';
import { calcularDestinos, calcularPreco } from '@/lib/lelis/preco';
import { VenderLelis, type ProdutoVenda } from './vender';

export const dynamic = 'force-dynamic';

const num = (x: string | null) => (x == null ? null : Number(x));

export default async function VenderLelisPage() {
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
      saldo: sql<number>`coalesce((SELECT sum(m.quantidade) FROM revenda_movimento m WHERE m.revenda_produto_id = ${schema.revendaProduto.id}), 0)::float`,
    })
    .from(schema.revendaProduto)
    .where(eq(schema.revendaProduto.filialId, filialId))
    .orderBy(asc(schema.revendaProduto.descricao));

  const lista: ProdutoVenda[] = produtos
    .filter(({ p }) => p.ativo)
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
      const tabela = calcularPreco({ ...base, pctImpostosVenda: num(p.pctImpostosVenda) ?? pctImpostosVenda }).preco;
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
        preco: empresa ?? tabela ?? null,
      };
    });

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">🍷 Lelis — vender pras casas</h1>
            <p className="mt-1 text-sm text-slate-500">
              Escolha a casa, busque o produto e ponha a quantidade. Sai sem nota: baixa o estoque da Lelis, fica a receber
              aqui e a conta a pagar na casa. A casa confere o que chegou em Transferências e aí entra no estoque de lá.
            </p>
          </div>
          <Link href="/lelis/precos" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Preços, notas e NF-e →
          </Link>
        </div>
        <VenderLelis produtos={lista} />
      </div>
    </main>
  );
}
