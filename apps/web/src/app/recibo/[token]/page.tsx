// /recibo/[token] — o recibo que vai pelo celular (link assinado, sem login).
// Só mostra o papel de uma conta PAGA; link falso ou conta apagada = 404.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { carregarRecibo, contaDoTokenRecibo } from '@/lib/recibo-avulso';
import { ReciboDocumento } from '@/components/recibo-documento';
import { BotaoImprimirRecibo } from './imprimir';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Recibo', robots: { index: false, follow: false } };

export default async function ReciboPublicoPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const contaId = contaDoTokenRecibo(token);
  if (!contaId) notFound();
  const r = await carregarRecibo(contaId);
  if (!r || !r.dataPagamento) notFound();

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 print:bg-white print:p-0">
      <ReciboDocumento r={r} />
      <div className="mx-auto mt-4 max-w-2xl text-center print:hidden">
        <BotaoImprimirRecibo />
      </div>
    </main>
  );
}
