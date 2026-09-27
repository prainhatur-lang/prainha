// Página pública do programa Cartão Prainha (sem login) — o link que vai na
// bio, no convite e no cartão. Mesmo conteúdo da tela de convite.

import type { Metadata } from 'next';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { carregarPrograma, CONFIG_PADRAO } from '@/lib/fidelidade/config';
import { ApresentacaoPrograma } from '@/components/fidelidade/apresentacao';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cartão Prainha — programa de fidelidade',
  description: 'Desconto no Pix, prioridade nas reservas e desconto no aluguel de espaços no Prainha Bar, Tabuará e Prainha Mar.',
};

// o programa é da organização; a página pública usa a do Prainha Bar (01)
const FILIAL_PRAINHA_BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';

export default async function CartaoPrainhaPage() {
  const [f] = await db
    .select({ org: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, FILIAL_PRAINHA_BAR))
    .limit(1);
  const cfg = f ? (await carregarPrograma(f.org)).config : CONFIG_PADRAO;
  const topo = cfg.niveis[cfg.niveis.length - 1];

  return (
    <main className="min-h-screen bg-[#f4efe6] px-4 py-8 text-slate-900">
      <div className="mx-auto w-full max-w-sm space-y-5">
        <div
          className="relative overflow-hidden rounded-2xl p-5 text-white shadow-xl"
          style={{ background: `linear-gradient(135deg, ${topo.cor} 0%, #0b2a45 100%)` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fidelidade/sereia-branca.png" alt="" className="absolute -right-6 -bottom-4 w-40 opacity-20" />
          <div className="text-xs uppercase tracking-widest opacity-80">Programa de fidelidade</div>
          <h1 className="mt-1 text-3xl font-bold">Cartão Prainha</h1>
          <p className="mt-2 text-sm opacity-90">
            Quem é da casa paga menos. Cinco categorias, do {cfg.niveis[0].nome} ao {topo.nome}, com desconto no Pix,
            prioridade nas reservas e desconto no aluguel de espaços.
          </p>
        </div>
        <ApresentacaoPrograma cfg={cfg} />
        <div className="rounded-2xl bg-white p-4 text-center text-sm shadow-sm">
          <div className="font-semibold">Como entrar</div>
          <p className="mt-1 text-slate-600">
            Peça o seu cartão ao garçom ou no caixa de qualquer uma das casas. É gratuito e sai na hora, no seu WhatsApp.
          </p>
        </div>
      </div>
    </main>
  );
}
