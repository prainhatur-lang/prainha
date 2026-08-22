// Layout do delivery público. Carrega as fontes das duas casas; qual vale é o
// tema da filial que decide (ver @/lib/tema-delivery), apontando
// --dlv-display/--dlv-body pro par certo na página de cada loja.

import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { DM_Serif_Display, Hanken_Grotesk, Playfair_Display, Inter } from 'next/font/google';

const dm = DM_Serif_Display({ subsets: ['latin'], weight: '400', variable: '--dlv-dm', display: 'swap' });
const hanken = Hanken_Grotesk({ subsets: ['latin'], variable: '--dlv-hanken', display: 'swap' });
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--dlv-playfair', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--dlv-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Delivery',
  description: 'Peça online pra entregar em casa ou retirar no balcão.',
};

export default function DeliveryLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${dm.variable} ${hanken.variable} ${playfair.variable} ${inter.variable} min-h-screen`}
      // Par e paleta padrão = Prainha. A página de cada loja sobrescreve
      // conforme a filial do slug.
      style={{
        ['--dlv-display' as string]: 'var(--dlv-dm)',
        ['--dlv-body' as string]: 'var(--dlv-hanken)',
        ['--dlv-page' as string]: '#fbf6ec',
        fontFamily: 'var(--dlv-body)',
        background: 'var(--dlv-page)',
      }}
    >
      {children}
    </div>
  );
}
