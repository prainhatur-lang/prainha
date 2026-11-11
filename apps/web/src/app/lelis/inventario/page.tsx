// Lelis — inventário (contagem física). Dono, 11/11/2026: "fazer uma tela de
// inventario". Digita o que contou em cada produto; ao gravar, o sistema lança
// um AJUSTE com a diferença e o saldo passa a ser o contado. Só Admin.
// Não troca nada das outras telas: /lelis/estoque, /lelis/precos e /lelis/vender
// continuam iguais (o saldo delas é a mesma soma de revenda_movimento).

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { ehAdmin } from '@/lib/usuario-admin';
import { lelisFilialId } from '@/lib/lelis/sincronizar';
import { InventarioLelis, type AjusteFeito, type ProdutoInventario } from './contagem';

export const dynamic = 'force-dynamic';

export default async function InventarioLelisPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!(await ehAdmin(user.id))) redirect('/');

  const filialId = await lelisFilialId();
  if (!filialId) redirect('/lelis/precos');

  const produtos = (await db.execute(sql`
    SELECT p.id, p.descricao, p.ean, p.unidade, p.ativo, (p.custo_unit + p.frete_unit)::float AS custo,
           coalesce((SELECT sum(m.quantidade) FROM revenda_movimento m WHERE m.revenda_produto_id = p.id), 0)::float AS saldo
      FROM revenda_produto p
     WHERE p.filial_id = ${filialId}::uuid
     ORDER BY p.descricao
  `)) as unknown as Array<ProdutoInventario & { ativo: boolean }>;

  const ajustes = (await db.execute(sql`
    SELECT m.id, p.descricao, m.quantidade::float AS quantidade, m.observacao, m.criado_por,
           to_char(m.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS quando
      FROM revenda_movimento m
      JOIN revenda_produto p ON p.id = m.revenda_produto_id
     WHERE m.filial_id = ${filialId}::uuid AND m.tipo = 'AJUSTE' AND m.observacao LIKE 'Inventário %'
     ORDER BY m.criado_em DESC
     LIMIT 100
  `)) as unknown as AjusteFeito[];

  const lista: ProdutoInventario[] = produtos
    .filter((p) => p.ativo || Number(p.saldo) !== 0)
    .map((p) => ({ id: p.id, descricao: p.descricao, ean: p.ean, unidade: p.unidade, custo: Number(p.custo), saldo: Number(p.saldo) }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">🍷 Lelis — inventário</h1>
            <p className="mt-1 text-sm text-slate-500">
              Digite o que foi contado em cada produto. Ao gravar, o estoque do sistema passa a ser o contado e a diferença fica
              registrada como ajuste.
            </p>
          </div>
          <Link href="/lelis/estoque" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Estoque disponível →
          </Link>
        </div>
        <InventarioLelis produtos={lista} ajustes={ajustes} />
      </div>
    </main>
  );
}
