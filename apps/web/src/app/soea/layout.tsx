import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Inter } from 'next/font/google';

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display-soea',
  display: 'swap',
});
const texto = Inter({ subsets: ['latin'], variable: '--font-texto-soea', display: 'swap' });

const TITULO = 'Prainha Bar · 81ª SOEA — drink de boas-vindas e desconto na conta';
const DESCRICAO =
  'Participante da 81ª SOEA é convidado do Prainha Bar, à beira-rio em Aracaju: cadastre-se e ganhe um drink de boas-vindas e desconto na conta, de 13 a 18 de outubro.';

export const metadata: Metadata = {
  metadataBase: new URL('https://soea.prainhabar.com'),
  title: TITULO,
  description: DESCRICAO,
  openGraph: {
    title: TITULO,
    description: DESCRICAO,
    type: 'website',
    locale: 'pt_BR',
    siteName: 'Prainha Bar',
    images: [{ url: '/soea/og.jpg', width: 1200, height: 630 }],
  },
  twitter: { card: 'summary_large_image', title: TITULO, description: DESCRICAO, images: ['/soea/og.jpg'] },
};

export const viewport: Viewport = { themeColor: '#160c08' };

export default function SoeaLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${display.variable} ${texto.variable}`}>{children}</div>;
}
