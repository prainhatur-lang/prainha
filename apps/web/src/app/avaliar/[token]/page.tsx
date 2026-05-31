// Pagina publica de avaliacao de clientes (sem login).
// Acessada via QR code na mesa/conta. O token na URL identifica a filial.
//
// Fluxo (gating pela filial.notaCorteGoogle):
//   - cliente toca 1-5 estrelas
//   - nota >= corte -> convida a publicar no Google (filial.googleReviewUrl)
//   - nota <  corte -> coleta nome + whatsapp + comentario pra equipe resolver

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { AvaliarForm } from './avaliar-form';

export const dynamic = 'force-dynamic';

export default async function AvaliarPage(props: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ o?: string }>;
}) {
  const { token } = await props.params;
  const { o: origem } = await props.searchParams;
  if (!token || token.length < 20) notFound();

  const [filial] = await db
    .select({
      id: schema.filial.id,
      nome: schema.filial.nome,
      googleReviewUrl: schema.filial.googleReviewUrl,
      notaCorteGoogle: schema.filial.notaCorteGoogle,
    })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) notFound();

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-sky-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        <AvaliarForm
          token={token}
          nomeFilial={filial.nome}
          corte={filial.notaCorteGoogle}
          googleUrl={filial.googleReviewUrl}
          origem={origem ?? null}
        />
      </div>
    </main>
  );
}
