// Layout do delivery público — mesmas fontes do fluxo de reserva
// (identidade "Golden Hour" do Prainha).

import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { DM_Serif_Display, Hanken_Grotesk } from 'next/font/google';

const display = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--dlv-display',
  display: 'swap',
});
const body = Hanken_Grotesk({ subsets: ['latin'], variable: '--dlv-body', display: 'swap' });

export const metadata: Metadata = {
  title: 'Delivery — Prainha Bar',
  description: 'Peça online pra entregar em casa ou retirar no balcão.',
};

export default function DeliveryLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${display.variable} ${body.variable} min-h-screen bg-[#fbf6ec]`}
      style={{ fontFamily: 'var(--dlv-body)' }}
    >
      {children}
    </div>
  );
}
