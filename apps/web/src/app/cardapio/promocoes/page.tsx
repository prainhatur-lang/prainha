// /cardapio/promocoes — aba PROMOÇÕES (31/10/2026), no jeito das Promoções do
// Consumer: num horário pré-determinado (happy hour) o produto tem
//   1) preço diferenciado (lib/preco-horario — mesma regra da /cardapio/preco-horario)
//   2) paga 1 leva 2 (chope dobrado; lib/promo-leve2)

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { itensDaCasa } from '@/lib/cardapio-destaque';
import { listarPrecosHorario } from '@/lib/preco-horario';
import { listarLeve2, produtosParaLeve2 } from '@/lib/promo-leve2';
import { PrecoHorarioClient } from '../preco-horario/preco-horario-client';
import { Leve2Client } from './leve2-client';

export const dynamic = 'force-dynamic';

export default async function PromocoesPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) redirect('/inicio');
  const filial = escolhida;
  const [regras, itens, leve2, produtos] = await Promise.all([
    listarPrecosHorario(filial.id),
    itensDaCasa(filial.id),
    listarLeve2(filial.id),
    produtosParaLeve2(filial.id),
  ]);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold text-slate-900">🏷️ Promoções por horário</h1>
          <a href={`/cardapio?filialId=${filial.id}`} className="text-sm text-blue-600 hover:underline">
            ← Cardápio
          </a>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Escolha o produto, os dias e a faixa de hora (ex.: seg a sex, 12h às 20h, exceto feriados). O sistema liga a
          promoção no início e desliga no fim, sozinho, de 5 em 5 minutos — vale no garçom, no caixa, na maquininha e
          no QR. Item já lançado na mesa não muda.
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

        <section className="mt-6">
          <h2 className="text-lg font-semibold text-slate-900">💲 Preço diferenciado no horário</h2>
          <p className="text-xs text-slate-500">
            O próprio produto muda de preço (ex.: R$ 60 → R$ 49) e volta ao normal no fim do horário.
          </p>
          <PrecoHorarioClient key={`p-${filial.id}`} filialId={filial.id} regras={regras} itens={itens} />
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900">🍺 Paga 1, leva 2 no horário</h2>
          <p className="text-xs text-slate-500">
            Dentro do horário o produto sai dobrado: o cliente paga 1, o 1º sai na hora e o 2º fica de vale na conta
            (R$ 0) até o garçom soltar. Fora do horário volta a ser 1 por 1. Só nas casas com servidor próprio
            (Prainha Bar e Prainha Mar); a loja recebe a mudança em até 10 minutos.
          </p>
          <Leve2Client key={`l-${filial.id}`} filialId={filial.id} regras={leve2} produtos={produtos} />
        </section>
      </div>
    </main>
  );
}
