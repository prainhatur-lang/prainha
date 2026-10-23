// Página mobile pública: foto do pedido sem nota pelo celular (QR do botão
// "📷 Escanear pedido agora" da Entrada de notas, no computador). Sem login —
// link assinado (f, u, k, e, s) que vence em 24 h. A foto vai pro computador
// que mostrou o QR, e é lá que o pedido é lido e lançado.

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { validarLinkPedidoCelular } from '@/lib/pedido-celular-link';
import { EnviarPedido } from './enviar-pedido';

export const dynamic = 'force-dynamic';

export default async function PedidoCelularPage(props: {
  searchParams: Promise<{ f?: string; u?: string; k?: string; e?: string; s?: string }>;
}) {
  const sp = await props.searchParams;
  const link = validarLinkPedidoCelular(sp.f, sp.u, sp.k, sp.e, sp.s);

  if (!link) {
    return (
      <main className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h1 className="text-base font-semibold text-slate-900">Link vencido</h1>
          <p className="mt-1 text-sm text-slate-600">
            Esse link vale 24 horas. No computador, abra Movimento → Entrada de notas e clique em
            <b> 📷 Escanear pedido agora</b> pra gerar outro QR.
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
        <EnviarPedido
          f={link.filialId}
          u={link.usuarioId}
          k={link.sessao}
          e={link.e}
          s={String(sp.s)}
          casa={filial?.nome ?? ''}
        />
      </div>
    </main>
  );
}
