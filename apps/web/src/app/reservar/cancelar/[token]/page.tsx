// Pagina publica pro cliente cancelar a reserva (link enviado na confirmacao).
import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { CancelarReserva } from './cancelar-reserva';

export const dynamic = 'force-dynamic';

export default async function CancelarPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!token || token.length < 20) notFound();

  const [r] = await db
    .select({
      clienteNome: schema.reserva.clienteNome,
      data: schema.reserva.data,
      hora: schema.reserva.hora,
      area: schema.reserva.area,
      pessoas: schema.reserva.pessoas,
      status: schema.reserva.status,
      filialNome: schema.filial.nome,
    })
    .from(schema.reserva)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.reserva.filialId))
    .where(eq(schema.reserva.cancelToken, token))
    .limit(1);
  if (!r) notFound();

  const [a, m, d] = r.data.split('-');
  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-4"
      style={{
        background:
          'linear-gradient(180deg,#07191c 0%,#143a3d 26%,#5a6a4f 46%,#c98a3f 66%,#e7873a 82%,#b3411c 100%)',
      }}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-[60%] h-[90vmin] w-[90vmin] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(255,236,184,0.55) 0%, rgba(231,135,58,0.18) 38%, transparent 64%)',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 30%, transparent 45%, rgba(7,25,28,0.45) 100%)',
        }}
        aria-hidden
      />

      <div className="relative w-full max-w-md">
        <div className="mb-6 text-center">
          <span
            className="text-3xl tracking-tight text-[#fbf6ec]"
            style={{ fontFamily: 'var(--rsv-display)' }}
          >
            Prainha<span className="text-[#f4b454]">.</span>
          </span>
        </div>
        <div className="rounded-3xl border border-[#e9d9bb] bg-[#fbf6ec] p-7 text-center shadow-[0_28px_70px_-30px_rgba(7,25,28,0.75)]">
          <h1 className="text-2xl text-[#1d130c]" style={{ fontFamily: 'var(--rsv-display)' }}>
            Sua reserva
          </h1>
          <p className="mt-1 text-sm text-[#8a7a64]">{r.filialNome}</p>
          <div className="mt-4 rounded-2xl border border-[#e9d9bb] bg-[#f6ecd9] p-4 text-sm text-[#1d130c]">
            <p className="text-lg font-bold" style={{ fontFamily: 'var(--rsv-display)' }}>
              {r.clienteNome}
            </p>
            <p className="mt-0.5 text-[#4a382a]">
              {`${d}/${m}/${a}`} às {r.hora} · {r.pessoas} pessoa(s){r.area ? ` · ${r.area}` : ''}
            </p>
          </div>
          <CancelarReserva token={token} jaCancelada={r.status === 'cancelada'} />
        </div>
      </div>
    </main>
  );
}
