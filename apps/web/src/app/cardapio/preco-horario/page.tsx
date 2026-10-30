// /cardapio/preco-horario — o MESMO produto muda de preço por horário
// (happy hour: isca de R$ 60 vira R$ 49 seg–sex 12h–20h). Pedido do dono 30/10/2026.
// Ver lib/preco-horario.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { itensDaCasa } from '@/lib/cardapio-destaque';
import { listarPrecosHorario } from '@/lib/preco-horario';
import { PrecoHorarioClient } from './preco-horario-client';

export const dynamic = 'force-dynamic';

export default async function PrecoHorarioPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) redirect('/inicio');
  const filial = escolhida;
  const [regras, itens] = await Promise.all([listarPrecosHorario(filial.id), itensDaCasa(filial.id)]);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold text-slate-900">Preço por horário (happy hour)</h1>
          <a href={`/cardapio/destaques?filialId=${filial.id}`} className="text-sm text-blue-600 hover:underline">
            ← Destaques do QR
          </a>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          O próprio produto muda de preço nos dias e horas escolhidos e volta ao preço normal no fim. Vale no
          garçom, no caixa, na maquininha e no QR. A troca é feita pelo sistema de 5 em 5 minutos e a loja aplica
          logo em seguida. Item já lançado na mesa não muda de preço.
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
        <PrecoHorarioClient key={filial.id} filialId={filial.id} regras={regras} itens={itens} />
      </div>
    </main>
  );
}
