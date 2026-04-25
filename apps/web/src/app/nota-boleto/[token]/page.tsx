// Pagina mobile publica pra envio de foto/PDF do boleto.
// Acessada via token gerado em /movimento/entrada-notas/[id].
// Sem login — token na URL eh autenticacao.

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { brl } from '@/lib/format';
import { UploadBoletoCliente } from './upload-cliente';

export const dynamic = 'force-dynamic';

export default async function NotaBoletoPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  if (!token || token.length < 20) notFound();

  const [nota] = await db
    .select({
      id: schema.notaCompra.id,
      numero: schema.notaCompra.numero,
      emitNome: schema.notaCompra.emitNome,
      valorTotal: schema.notaCompra.valorTotal,
      dataEmissao: schema.notaCompra.dataEmissao,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.boletoTokenPublico, token))
    .limit(1);
  if (!nota) notFound();

  return (
    <main className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto max-w-md">
        <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h1 className="text-base font-semibold text-slate-900">📷 Foto do boleto</h1>
          <p className="mt-1 text-xs text-slate-500">
            Tire a foto do boleto desta nota. Não precisa logar.
          </p>
          <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-xs">
            <p className="font-medium text-slate-800">{nota.emitNome}</p>
            <p className="font-mono text-[10px] text-slate-500">
              NFe nº {nota.numero ?? '—'}
              {nota.dataEmissao && (
                <>
                  {' · '}
                  {new Date(nota.dataEmissao).toLocaleDateString('pt-BR')}
                </>
              )}
            </p>
            <p className="font-mono text-[10px] text-slate-500">
              Total: <span className="font-semibold">{brl(nota.valorTotal)}</span>
            </p>
          </div>
        </header>

        <UploadBoletoCliente token={token} />
      </div>
    </main>
  );
}
