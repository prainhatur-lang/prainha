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
    .map((a) => ({ nome: a.nome, horaLimite: a.horaLimite ?? null }));

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-sky-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        <ReservarForm
          token={token}
          nomeFilial={filial.nome}
          areas={areas}
          valorCheio={typeof cfg?.valorCheio === 'number' ? cfg.valorCheio : null}
          valorAtual={typeof cfg?.valorAtual === 'number' ? cfg.valorAtual : 0}
          hoje={hojeBr()}
          semOtp={!!cfg?.semOtp}
        />
      </div>
    </main>
  );
}
