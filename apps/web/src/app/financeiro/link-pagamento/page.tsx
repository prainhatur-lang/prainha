// Link de pagamento por cartão (25/11/2026, pedido do dono): cobrança avulsa de
// qualquer valor — evento, sinal, saldo. Uso único e 3DS obrigatório. O cliente
// paga em /cobranca/<token>. Também dá pra gerar de dentro da reserva.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { LinkPagamentoPainel } from '@/components/link-pagamento-painel';

export const dynamic = 'force-dynamic';

export default async function LinkPagamentoPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_receber.create');

  const filiais = await filiaisDoFinanceiro(user.id);
  const sp = await props.searchParams;
  const filial = (await escolherFilial(filiais, sp.filialId)) ?? filiais[0];
  if (!filial) redirect('/financeiro');

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-2xl px-6 py-6">
        <Link href="/financeiro" className="text-xs text-sky-700 hover:underline">
          ← Contas a pagar
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">💳 Link de pagamento por cartão</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Gera um link pra mandar ao cliente. Vale pra um único pagamento e só aprova com a confirmação
          do banco dele (3-D Secure).
        </p>
        {filiais.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/financeiro/link-pagamento?filialId=${f.id}`}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  f.id === filial.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}
        <div className="mt-4">
          <LinkPagamentoPainel key={filial.id} filialId={filial.id} />
        </div>
      </div>
    </main>
  );
}
