// Pagina publica pro cliente cancelar a reserva (link enviado na confirmacao).
import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { CancelarReserva } from './cancelar-reserva';
import { temaDaFilial } from '../../[token]/tema';

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
  const tema = temaDaFilial(r.filialNome);
  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-4"
      style={{
        ...tema.vars,
        '--rsv-display': tema.fonte === 'playfair' ? 'var(--rsv-playfair)' : 'var(--rsv-dm)',
        '--rsv-body': tema.fonte === 'playfair' ? 'var(--rsv-inter)' : 'var(--rsv-hanken)',
        fontFamily: 'var(--rsv-body)',
        background: 'var(--rsv-bg)',
      } as React.CSSProperties}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-[60%] h-[90vmin] w-[90vmin] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'var(--rsv-glow)' }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'var(--rsv-vignette)' }}
        aria-hidden
      />

      <div className="relative w-full max-w-md">
        <div className="mb-6 text-center">
          <span
            className="text-3xl tracking-tight text-[var(--rsv-brand)]"
            style={{ fontFamily: 'var(--rsv-display)' }}
          >
            {tema.marca}
            <span className="text-[var(--rsv-brand-dot)]">.</span>
          </span>
        </div>
        <div className="rounded-3xl border border-[var(--rsv-card-border)] bg-[var(--rsv-card-bg)] p-7 text-center shadow-[var(--rsv-card-shadow)]">
          <h1 className="text-2xl text-[var(--rsv-ink)]" style={{ fontFamily: 'var(--rsv-display)' }}>
            Sua reserva
          </h1>
          <p className="mt-1 text-sm text-[var(--rsv-muted)]">{r.filialNome}</p>
          <div className="mt-4 rounded-2xl border border-[var(--rsv-card-border)] bg-[var(--rsv-surface)] p-4 text-sm text-[var(--rsv-ink)]">
            <p className="text-lg font-bold" style={{ fontFamily: 'var(--rsv-display)' }}>
              {r.clienteNome}
            </p>
            <p className="mt-0.5 text-[var(--rsv-text)]">
              {`${d}/${m}/${a}`} às {r.hora} · {r.pessoas} pessoa(s){r.area ? ` · ${r.area}` : ''}
            </p>
          </div>
          <CancelarReserva token={token} jaCancelada={r.status === 'cancelada'} />
        </div>
      </div>
    </main>
  );
}
