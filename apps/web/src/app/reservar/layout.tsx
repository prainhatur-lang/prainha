// Layout escopado da reserva pública do cliente — visual "Golden Hour" do site
// novo (DM Serif Display + Hanken Grotesk), sem afetar o resto do app.
import { DM_Serif_Display, Hanken_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';

const display = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--rsv-display',
  display: 'swap',
});

const body = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--rsv-body',
  display: 'swap',
});

export default function ReservarLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${display.variable} ${body.variable}`}
      style={{ fontFamily: 'var(--rsv-body)' }}
    >
      {children}
    </div>
  );
}
