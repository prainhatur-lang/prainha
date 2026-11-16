// /recibo/foto/[token] — abre no celular pelo QR da tela do recibo: tira a
// foto do recibo assinado e ela vai pra conta. Sem login (link assinado, 24 h).

import type { Metadata } from 'next';
import { carregarRecibo } from '@/lib/recibo-avulso';
import { contaDoTokenFoto } from '@/lib/recibo-assinado';
import { brl } from '@/lib/format';
import { FotoReciboCelular } from './foto';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Foto do recibo assinado', robots: { index: false, follow: false } };

export default async function FotoReciboPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const contaId = contaDoTokenFoto(token);
  const r = contaId ? await carregarRecibo(contaId) : null;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-5 shadow-sm">
        {!r ? (
          <>
            <h1 className="text-lg font-semibold text-slate-900">Link vencido</h1>
            <p className="mt-2 text-sm text-slate-600">
              Abra de novo o QR Code na tela do recibo, no computador, e aponte a câmera.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-slate-900">Foto do recibo assinado</h1>
            <p className="mt-1 text-sm text-slate-600">
              {r.recebedorNome} · {brl(r.valor)}
              {r.descricao ? ` · ${r.descricao}` : ''}
            </p>
            <FotoReciboCelular token={token} />
          </>
        )}
      </div>
    </main>
  );
}
