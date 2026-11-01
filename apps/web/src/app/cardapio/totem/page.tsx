// /cardapio/totem — cardápio do totem de autoatendimento da recepção
// (01/11/2026). Liga os itens que aparecem na tela de toque e em qual grupo.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { itensDaCasa } from '@/lib/cardapio-destaque';
import { GRUPOS_TOTEM, listarTotem } from '@/lib/cardapio-totem';
import { TotemClient } from './totem-client';
import { EstoqueRecepcao } from './estoque-client';

export const dynamic = 'force-dynamic';

export default async function TotemPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) redirect('/inicio');
  const filial = escolhida;
  const [ligados, itens] = await Promise.all([listarTotem(filial.id), itensDaCasa(filial.id)]);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold text-slate-900">Totem de autoatendimento</h1>
          <a href={`/cardapio?filialId=${filial.id}`} className="text-sm text-blue-600 hover:underline">
            ← Cardápio
          </a>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Cardápio só do totem da recepção: o cliente escolhe, paga no Pix na própria tela e retira no balcão com o
          número do pedido (o pedido sai na impressora do bar). Só aparece o que estiver ligado aqui. A loja
          atualiza em até 5 min. Tela do totem: <code>/totem</code> no servidor da loja.
        </p>
        {filiais.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {filiais.map((f) => (
              <a
                key={f.id}
                href={`?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  f.id === filial.id
                    ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </a>
            ))}
          </div>
        )}
        <TotemClient
          key={filial.id}
          filialId={filial.id}
          grupos={GRUPOS_TOTEM.map((g) => ({ id: g.id, nome: g.nome, emoji: g.emoji }))}
          inicial={ligados}
          itens={itens}
        />
        <EstoqueRecepcao key={'est-' + filial.id} filialId={filial.id} />
      </div>
    </main>
  );
}
