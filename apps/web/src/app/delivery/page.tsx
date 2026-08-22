// /delivery — porta de entrada do delivery. Uma loja ativa só? Vai direto
// pro cardápio dela. Várias? Lista pra escolher. Nenhuma? Aviso amigável.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { lojasDeliveryAtivas } from '@/lib/delivery/config';

export const dynamic = 'force-dynamic';

export default async function DeliveryHome() {
  const lojas = await lojasDeliveryAtivas();

  if (lojas.length === 1) redirect(`/delivery/${lojas[0].config.slug}`);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-5 py-10">
      <span
        className="text-4xl tracking-tight text-[var(--dlv-strong)]"
        style={{ fontFamily: 'var(--dlv-display)' }}
      >
        Prainha<span className="text-[var(--dlv-brand-dot)]">.</span>
      </span>
      <p className="mt-2 text-center text-sm text-[var(--dlv-muted)]">Delivery e retirada</p>

      {lojas.length === 0 ? (
        <div className="mt-8 w-full rounded-2xl border border-[var(--dlv-card-line)] bg-[var(--dlv-card)] p-6 text-center">
          <p className="text-sm text-[var(--dlv-text)]">
            Nosso delivery ainda não está aberto por aqui. Volte em breve! 🌅
          </p>
        </div>
      ) : (
        <div className="mt-8 w-full space-y-3">
          {lojas.map((l) => (
            <Link
              key={l.filialId}
              href={`/delivery/${l.config.slug}`}
              className="block rounded-2xl border border-[var(--dlv-card-line)] bg-[var(--dlv-card)] p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--dlv-accent)]"
            >
              <p className="text-lg font-semibold text-[var(--dlv-ink)]">
                {l.config.titulo ?? l.nome}
              </p>
              {l.config.subtitulo ? (
                <p className="mt-0.5 text-sm text-[var(--dlv-muted)]">{l.config.subtitulo}</p>
              ) : null}
              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--dlv-accent)]">
                Ver cardápio →
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
