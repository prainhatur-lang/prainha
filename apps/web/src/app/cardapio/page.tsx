// /cardapio — cardápio interno com selos de restrição alimentar.
// Garçom consulta no celular ("esse prato tem glúten?"); gestor liga/desliga
// os selos 🌾 sem glúten e 🥛 sem lactose por prato. Base: mesmos itens ativos
// do cardápio público (produto_variante.menu_dino).

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { lerRestricoes } from '@/lib/cardapio-restricoes';
import { CardapioClient } from './cardapio-client';

export const dynamic = 'force-dynamic';

const FILIAL_PRAINHA = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';

export default async function CardapioPage(props: {
  searchParams: Promise<{ filialId?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sp = await props.searchParams;
  const filialId = sp.filialId ?? FILIAL_PRAINHA;

  const linhas = (await db.execute(sql`
    SELECT DISTINCT p.id, p.nome, LEFT(COALESCE(p.descricao, ''), 160) AS descricao
    FROM produto_variante pv
    JOIN produto p ON p.id = pv.produto_id
    WHERE p.filial_id = ${filialId}
      AND pv.menu_dino
      AND pv.data_delete IS NULL
      AND pv.data_pausado IS NULL
      AND (p.descontinuado IS NOT TRUE)
      AND (p.data_pausado IS NULL)
      AND pv.preco_venda > 0
    ORDER BY p.nome
    LIMIT 800
  `)) as unknown as Array<{ id: string; nome: string; descricao: string }>;

  const restricoes = await lerRestricoes();

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-xl font-semibold text-slate-900">Cardápio — restrições alimentares</h1>
        <p className="mt-1 text-xs text-slate-500">
          Selos confirmados pela cozinha. Toque nos selos pra ligar/desligar. Todos os molhos da
          casa são engrossados com <strong>amido de milho</strong> (sem glúten); os caldinhos não
          levam espessante; a <strong>farofa tem lactose</strong> (manteiga), mas a cozinha faz no
          azeite a pedido.
        </p>
        <CardapioClient
          itens={linhas.map((l) => ({
            id: l.id,
            nome: l.nome,
            descricao: l.descricao,
            semGluten: restricoes.get(l.id)?.semGluten ?? false,
            semLactose: restricoes.get(l.id)?.semLactose ?? false,
            obs: restricoes.get(l.id)?.obs ?? '',
          }))}
        />
      </div>
    </main>
  );
}
