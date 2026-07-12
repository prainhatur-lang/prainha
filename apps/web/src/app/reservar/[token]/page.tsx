// Pagina publica de reserva do cliente (sem login). Token na URL = filial.
// Cliente escolhe espaco/data/hora/pessoas, valida WhatsApp por OTP e confirma.

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';
import { ReservarForm, type AreaPub } from './reservar-form';

export const dynamic = 'force-dynamic';

export default async function ReservarPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!token || token.length < 20) notFound();

  const [filial] = await db
    .select({
      nome: schema.filial.nome,
      reservaConfig: schema.filial.reservaConfig,
    })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) notFound();

  const cfg = filial.reservaConfig;
  const areas: AreaPub[] = (cfg?.areas ?? [])
    .filter((a) => a.ativo && !a.somenteEventos)
    .map((a) => ({ nome: a.nome, horaLimite: a.horaLimite ?? null, taxaReserva: a.taxaReserva ?? null }));

  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-4"
      style={{
        background:
          'linear-gradient(180deg,#07191c 0%,#143a3d 26%,#5a6a4f 46%,#c98a3f 66%,#e7873a 82%,#b3411c 100%)',
      }}
    >
      {/* brilho do sol */}
      <div
        className="pointer-events-none absolute left-1/2 top-[60%] h-[90vmin] w-[90vmin] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(255,236,184,0.55) 0%, rgba(231,135,58,0.18) 38%, transparent 64%)',
        }}
        aria-hidden
      />
      {/* vinheta p/ legibilidade */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 30%, transparent 45%, rgba(7,25,28,0.45) 100%)',
        }}
        aria-hidden
      />

      <div className="relative w-full max-w-md lg:max-w-5xl">
        <div className="lg:grid lg:grid-cols-2 lg:items-center lg:gap-14">
          {/* Marca + destaque (no computador vira um painel à esquerda) */}
          <div className="mb-6 text-center lg:mb-0 lg:text-left">
            <span
              className="text-3xl tracking-tight text-[#fbf6ec] lg:text-4xl"
              style={{ fontFamily: 'var(--rsv-display)' }}
            >
              Prainha<span className="text-[#f4b454]">.</span>
            </span>
            {/* Conteúdo extra só no computador */}
            <div className="mt-7 hidden lg:block">
              <h1
                className="text-[2.6rem] leading-[1.05] text-[#fbf6ec]"
                style={{ fontFamily: 'var(--rsv-display)' }}
              >
                Sua mesa com o melhor pôr do sol de Sergipe.
              </h1>
              <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-[#fbf6ec]/85">
                À beira do rio Vaza Barris, em Matapoã. Reserve em 1 minuto e a
                gente garante seu lugar pra hora dourada.
              </p>
              <ul className="mt-7 space-y-3 text-sm text-[#fbf6ec]/90">
                <li>🌅 Vista do pôr do sol</li>
                <li>🍤 Frutos do mar fresquinhos</li>
                <li>📍 À beira do rio, em Matapoã</li>
              </ul>
            </div>
          </div>
          {/* Pausa hoje é por dia (excecoes[].fechado), tratada dentro do
              formulário conforme a data escolhida — não há mais gate global aqui. */}
          <div className="lg:max-w-md">
            <ReservarForm
              token={token}
              nomeFilial={filial.nome}
              areas={areas}
              valorCheio={typeof cfg?.valorCheio === 'number' ? cfg.valorCheio : null}
              valorAtual={typeof cfg?.valorAtual === 'number' ? cfg.valorAtual : 0}
              hoje={hojeBr()}
              semOtp={!!cfg?.semOtp}
              bebidas={cfg?.bebidas ?? []}
              atendimento={cfg?.atendimento ? { inicio: cfg.atendimento.inicio, fim: cfg.atendimento.fim } : null}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
