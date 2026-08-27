// Canal de ouvidoria — página pública anônima (sem login). Token identifica
// a filial. Nada de identificação é coletado — ver contrato de anonimato em
// packages/db/src/schema/escuta.ts.

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { CanalForm } from './canal-form';

export const dynamic = 'force-dynamic';

export default async function CanalPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!token || token.length < 20) notFound();

  const [filial] = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.ouvidoriaToken, token))
    .limit(1);
  if (!filial) notFound();

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-100 to-slate-200 p-4">
      <div className="w-full max-w-md">
        <CanalForm token={token} nomeFilial={filial.nome} />
      </div>
    </main>
  );
}
