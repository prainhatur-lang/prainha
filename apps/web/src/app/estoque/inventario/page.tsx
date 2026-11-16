// Inventário (contagem física) do estoque da casa. Dono, 16/11/2026: "Ajuste
// manual (Saldo & Custo) deverá ser exclusivamente por inventário a partir de
// agora". Digita o que contou; ao gravar, o sistema lança um ajuste com a
// diferença e o saldo passa a ser o contado.
// Só aparece o que GUARDA saldo: insumo, ou produto de venda sem insumo. Produto
// de venda que baixa de insumo não entra (regra "ou é insumo ou é o produto").
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { Inventario, type AjusteFeito, type ProdutoInventario } from './contagem';

export const dynamic = 'force-dynamic';

export default async function InventarioPage(props: { searchParams: Promise<{ filialId?: string; busca?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'produto.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const sel = await escolherFilial(filiais, sp.filialId);
  if (!sel) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-5xl px-4 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = sel;

  const produtos = (await db.execute(sql`
    SELECT p.id, p.nome, p.tipo, coalesce(p.unidade_estoque, '') AS unidade,
           coalesce(p.estoque_atual, 0)::float AS saldo, coalesce(p.preco_custo, 0)::float AS custo
      FROM produto p
     WHERE p.filial_id = ${filial.id}::uuid
       AND p.controla_estoque
       AND p.tipo <> 'VENDA_COMPOSTO'
       AND (coalesce(p.descontinuado, false) = false OR coalesce(p.estoque_atual, 0) <> 0)
       AND NOT (p.tipo <> 'INSUMO' AND EXISTS (
             SELECT 1 FROM ficha_tecnica ft JOIN produto i ON i.id = ft.insumo_id
              WHERE ft.produto_id = p.id AND ft.baixa_estoque AND i.controla_estoque AND i.id <> p.id))
     ORDER BY p.nome
  `)) as unknown as Array<{ id: string; nome: string | null; tipo: string; unidade: string; saldo: number; custo: number }>;

  const ajustes = (await db.execute(sql`
    SELECT m.id, p.nome AS descricao, m.quantidade::float AS quantidade, m.observacao,
           to_char(m.data_hora AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS quando
      FROM movimento_estoque m
      JOIN produto p ON p.id = m.produto_id
     WHERE m.filial_id = ${filial.id}::uuid
       AND m.tipo IN ('ENTRADA_AJUSTE', 'SAIDA_AJUSTE')
       AND m.observacao LIKE 'Inventário %'
     ORDER BY m.data_hora DESC
     LIMIT 100
  `)) as unknown as AjusteFeito[];

  const lista: ProdutoInventario[] = produtos.map((p) => ({
    id: p.id,
    descricao: p.nome ?? '(sem nome)',
    insumo: p.tipo === 'INSUMO',
    unidade: p.unidade,
    custo: Number(p.custo),
    saldo: Number(p.saldo),
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Inventário — {filial.nome}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Digite o que foi contado em cada item. Ao gravar, o estoque do sistema passa a ser o contado e a diferença fica
              registrada como ajuste. Produto que baixa de insumo não aparece: conta-se o insumo.
            </p>
          </div>
          <Link href="/relatorios/estoque" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Posição de estoque →
          </Link>
        </div>
        <Inventario key={filial.id} filialId={filial.id} produtos={lista} ajustes={ajustes} buscaInicial={sp.busca ?? ''} />
      </div>
    </main>
  );
}
