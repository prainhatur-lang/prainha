// "Chegou estoque e não está à venda" (dono, 11/11/2026): produto autorizado
// some e volta sozinho pelo estoque; na dúvida — entrou estoque de um produto
// que está desligado pro garçom, pro QR do cliente ou pro delivery — o sistema
// PERGUNTA aqui se é pra ligar. Nada liga sozinho.
// Permissão de ver: 'relatorio.read' (layout de /relatorios). Ligar exige
// 'produto.update' (garçom/QR) e 'delivery.create' (delivery), conferidas na API.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { perguntasDeAtivacao, DIAS_PERGUNTA } from '@/lib/ativar-venda';
import { ListaAtivar } from './lista';

export const dynamic = 'force-dynamic';

export default async function AtivarVendaPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = escolhida;
  const dados = await perguntasDeAtivacao(filial.id);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
        <header>
          <h1 className="text-xl font-semibold text-slate-900">Chegou estoque e não está à venda</h1>
          <p className="mt-1 text-sm text-slate-600">
            {filial.nome} · produtos que receberam estoque nos últimos {DIAS_PERGUNTA} dias, têm saldo e estão
            desligados em algum lugar. Ligo pro garçom, pro cliente (QR) e pro delivery?
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Quem já está ligado some sozinho quando o estoque zera e volta quando o estoque volta. O garçom e o QR
            mudam na loja em cerca de 1 minuto depois de ligar.
          </p>
        </header>
        <ListaAtivar filialId={filial.id} {...dados} />
      </section>
    </main>
  );
}
