// Pesquisa de clima organizacional (eNPS) — página pública anônima. Token
// identifica a filial. A janela de resposta é decidida no servidor.

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { janelaClima } from '@/lib/clima/janela';
import { ClimaForm } from './clima-form';

export const dynamic = 'force-dynamic';

export default async function ClimaPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!token || token.length < 20) notFound();

  const [filial] = await db
    .select({
      id: schema.filial.id,
      nome: schema.filial.nome,
      climaDiasJanela: schema.filial.climaDiasJanela,
      climaAbertoAte: schema.filial.climaAbertoAte,
    })
    .from(schema.filial)
    .where(eq(schema.filial.climaToken, token))
    .limit(1);
  if (!filial) notFound();

  const janela = janelaClima(filial.climaDiasJanela, filial.climaAbertoAte);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-100 to-slate-200 p-4">
      <div className="w-full max-w-md">
        {janela.aberto ? (
          <ClimaForm token={token} nomeFilial={filial.nome} />
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <div className="text-4xl">📅</div>
            <h1 className="mt-3 text-lg font-semibold text-slate-900">Pesquisa fechada no momento</h1>
            <p className="mt-1 text-sm text-slate-500">
              A pesquisa de clima do {filial.nome} abre nos primeiros dias de cada mês. Volte em
              breve.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
