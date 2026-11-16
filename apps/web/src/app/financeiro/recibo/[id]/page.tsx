// Recibo de uma conta paga: imprime ou envia pelo celular. Serve pro recibo
// avulso (/financeiro/recibo) e pra qualquer conta paga que tenha fornecedor.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { carregarRecibo, tokenRecibo } from '@/lib/recibo-avulso';
import { brl } from '@/lib/format';
import { ReciboDocumento } from '@/components/recibo-documento';
import { AcoesRecibo } from './acoes';

export const dynamic = 'force-dynamic';

export default async function ReciboPage(props: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.read');

  const { id } = await props.params;
  const r = await carregarRecibo(id);
  if (!r) notFound();
  const filiais = await filiaisDoFinanceiro(user.id);
  if (!filiais.some((f) => f.id === r.filialId)) notFound();

  const token = tokenRecibo(r.contaId);

  return (
    <main className="min-h-screen bg-slate-50 print:bg-white">
      <div className="mx-auto max-w-3xl space-y-4 px-6 py-6 print:max-w-none print:p-0">
        <div className="flex items-center justify-between gap-3 print:hidden">
          <Link href="/financeiro" className="text-xs text-sky-700 hover:underline">
            ← Contas a pagar
          </Link>
          <div className="flex gap-4 text-xs">
            <Link href={`/financeiro/conta/${r.contaId}`} className="text-sky-700 hover:underline">
              Ver a conta
            </Link>
            <Link href={`/financeiro/recibo?filialId=${r.filialId}`} className="text-sky-700 hover:underline">
              + Outro recibo
            </Link>
          </div>
        </div>

        {r.dataPagamento ? (
          <>
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 print:hidden">
              ✓ Conta lançada e baixada{r.forma ? ` — paga em ${r.forma.toLowerCase()}` : ''}. Agora é só
              imprimir ou enviar.
            </div>
            <AcoesRecibo
              link={token ? `/recibo/${token}` : null}
              telefone={r.recebedorFone}
              texto={`Recibo de ${brl(r.valor)} — ${r.pagadorNome}. Referente a ${r.descricao || 'serviço prestado'}.`}
            />
            <ReciboDocumento r={r} />
          </>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">
              Entrou no contas a pagar: {r.recebedorNome} · {brl(r.valor)} · vence em{' '}
              {r.dataVencimento.split('-').reverse().join('/')}
            </p>
            <p className="mt-1">
              Ainda não foi pago, então não tem recibo. Quando pagar, registre o pagamento na conta e o
              recibo fica disponível aqui.
            </p>
            <Link
              href={`/financeiro/conta/${r.contaId}`}
              className="mt-3 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Abrir a conta
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
