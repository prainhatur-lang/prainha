// Página pública pro cliente CONFIRMAR (ou cancelar) a reserva — link enviado
// no lembrete da véspera (WhatsApp).
import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { ConfirmarReserva } from './confirmar-reserva';

export const dynamic = 'force-dynamic';

export default async function ConfirmarPage(props: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await props.params;
  // Botao de URL dinamica da Meta pode anexar a var ("{{1}}xxx") em vez de
  // substituir — limpa o prefixo {{N}}.
  const token = rawToken.replace(/^(\{\{\d+\}\})+/, '');
  if (!token || token.length < 20) notFound();

  const [r] = await db
    .select({
      clienteNome: schema.reserva.clienteNome,
      data: schema.reserva.data,
      hora: schema.reserva.hora,
      area: schema.reserva.area,
      pessoas: schema.reserva.pessoas,
      status: schema.reserva.status,
      confirmadaClienteEm: schema.reserva.confirmadaClienteEm,
      filialNome: schema.filial.nome,
    })
    .from(schema.reserva)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.reserva.filialId))
    .where(eq(schema.reserva.cancelToken, token))
    .limit(1);
  if (!r) notFound();

  const [a, m, d] = r.data.split('-');
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-sky-50 to-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Confirmar reserva — {r.filialNome}</h1>
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          <p className="font-medium">{r.clienteNome}</p>
          <p>
            {`${d}/${m}/${a}`} às {r.hora} · {r.pessoas} pessoa(s)
            {r.area ? ` · ${r.area}` : ''}
          </p>
        </div>
        <ConfirmarReserva
          token={token}
          jaCancelada={r.status === 'cancelada'}
          jaConfirmada={!!r.confirmadaClienteEm}
        />
      </div>
    </main>
  );
}
