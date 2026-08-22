// Layout escopado da reserva pública do cliente. Carrega as fontes das duas
// casas; qual delas vale é o tema da filial que decide (ver ./[token]/tema.ts),
// apontando --rsv-display/--rsv-body pro par certo. Nada disso vaza pro app.
import { DM_Serif_Display, Hanken_Grotesk, Playfair_Display, Inter } from 'next/font/google';
import type { ReactNode } from 'react';

const dm = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--rsv-dm',
  display: 'swap',
});

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--rsv-hanken',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--rsv-playfair',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--rsv-inter',
  display: 'swap',
});

export default function ReservarLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${dm.variable} ${hanken.variable} ${playfair.variable} ${inter.variable}`}
      // Par padrão = Prainha. As telas de cancelar/confirmar herdam daqui;
      // a página da reserva sobrescreve conforme a filial do token.
      style={{
        ['--rsv-display' as string]: 'var(--rsv-dm)',
        ['--rsv-body' as string]: 'var(--rsv-hanken)',
        fontFamily: 'var(--rsv-body)',
      }}
    >
      {children}
    </div>
  );
}
