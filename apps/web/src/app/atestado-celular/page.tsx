// Página mobile pública: foto do atestado pelo celular (QR do RH → Banco de
// horas). Sem login — link assinado (f, u, e, s) que vence em 24 h.

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { validarLinkAtestado } from '@/lib/rh/atestado-link';
import { EnviarAtestado } from './enviar-atestado';

export const dynamic = 'force-dynamic';

export default async function AtestadoCelularPage(props: {
  searchParams: Promise<{ f?: string; u?: string; e?: string; s?: string }>;
}) {
  const sp = await props.searchParams;
  const link = validarLinkAtestado(sp.f, sp.u, sp.e, sp.s);

  if (!link) {
    return (
      <main className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h1 className="text-base font-semibold text-slate-900">Link vencido</h1>
          <p className="mt-1 text-sm text-slate-600">
            Esse link vale 24 horas. No computador, abra RH → Banco de horas e clique em
            <b> 📱 Pelo celular</b> no quadro de atestados pra gerar outro QR.
          </p>
        </div>
      </main>
    );
  }

  const [filial] = await db
    .select({ nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, link.filialId))
    .limit(1);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-md p-4">
        <EnviarAtestado f={link.filialId} u={link.usuarioId} e={link.e} s={String(sp.s)} casa={filial?.nome ?? ''} />
      </div>
    </main>
  );
}
