import type { Metadata } from 'next';
import { Cormorant_Garamond, EB_Garamond } from 'next/font/google';

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-display-mar',
  display: 'swap',
});
const texto = EB_Garamond({
  subsets: ['latin'],
  variable: '--font-texto-mar',
  display: 'swap',
});

const TITULO = 'Prainha Mar e Grill — Frutos do mar e brasa · Aracaju';
const DESCRICAO =
  'Na Rodovia dos Náufragos, em Aracaju, a Prainha Mar e Grill serve frutos do mar, moquecas, carnes na brasa e drinks autorais. Veja o cardápio e reserve pelo WhatsApp.';

export const metadata: Metadata = {
  metadataBase: new URL('https://prainhamar.com.br'),
  title: TITULO,
  description: DESCRICAO,
  icons: { icon: '/prainhamar/selo.svg', apple: '/prainhamar/icone.png' },
  openGraph: {
    title: TITULO,
    description: DESCRICAO,
    type: 'website',
    locale: 'pt_BR',
    siteName: 'Prainha Mar e Grill',
    images: [{ url: '/prainhamar/og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITULO,
    description: DESCRICAO,
    images: ['/prainhamar/og.png'],
  },
};

export default function PrainhaMarLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${display.variable} ${texto.variable}`}>{children}</div>;
}
