// /cardapio/destaques — card no topo do cardápio do QR da mesa (26/10/2026):
// "Almoço executivo" (Bar e Mar), "Almoço convidativo" (Tabuará), "Happy hour".
// Diz os dias/hora e liga os itens; só aparece com "Mostrar no cardápio do QR".

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { itensDaCasa, listarDestaques } from '@/lib/cardapio-destaque';
import { DestaquesClient } from './destaques-client';

export const dynamic = 'force-dynamic';

export default async function DestaquesPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) redirect('/inicio');
  const filial = escolhida;
  const [destaques, itens] = await Promise.all([listarDestaques(filial.id), itensDaCasa(filial.id)]);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold text-slate-900">Destaques do cardápio do QR</h1>
          <span className="flex gap-3">
            <a href={`/cardapio/preco-horario?filialId=${filial.id}`} className="text-sm text-blue-600 hover:underline">
              🕔 Preço por horário
            </a>
            <a href={`/cardapio?filialId=${filial.id}`} className="text-sm text-blue-600 hover:underline">
              ← Cardápio
            </a>
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Card que aparece no topo do cardápio do QR da mesa explicando os dias e o horário (almoço executivo,
          happy hour…). Só aparece com <strong>Mostrar no cardápio do QR</strong> ligado. Dentro do horário o
          cliente toca e pede os itens ligados; fora, o card mostra quando vale. A loja atualiza em até 10 min.
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
        <DestaquesClient key={filial.id} filialId={filial.id} inicial={destaques} itens={itens} />
      </div>
    </main>
  );
}
