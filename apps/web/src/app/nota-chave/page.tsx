// Página mobile pública: câmera do celular lendo a chave de acesso do DANFE.
// Aberta pelo QR da Entrada de notas (igual à foto do boleto). Sem login —
// o link é assinado (f, e, s) e vence em 24 h; cada chave lida já traz a
// nota da SEFAZ pra casa do link.

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { validarLinkNotaChave } from '@/lib/nota-chave-link';
import { CameraChave } from './camera-chave';

export const dynamic = 'force-dynamic';

export default async function NotaChavePage(props: {
  searchParams: Promise<{ f?: string; e?: string; s?: string }>;
}) {
  const sp = await props.searchParams;
  const filialId = validarLinkNotaChave(sp.f, sp.e, sp.s);

  if (!filialId) {
    return (
      <main className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h1 className="text-base font-semibold text-slate-900">Link vencido</h1>
          <p className="mt-1 text-sm text-slate-600">
            Esse link vale 24 horas. No computador, abra Movimento → Entrada de notas e clique em
            <b> 📱 Ler pelo celular</b> pra gerar outro QR.
          </p>
        </div>
      </main>
    );
  }

  const [filial] = await db
    .select({ nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-md">
        <CameraChave f={filialId} e={Number(sp.e)} s={String(sp.s)} casa={filial?.nome ?? ''} />
      </div>
    </main>
  );
}
