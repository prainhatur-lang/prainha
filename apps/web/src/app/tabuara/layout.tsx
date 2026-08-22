import type { Metadata } from 'next';
import { Playfair_Display, Inter } from 'next/font/google';

const serif = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-serif-tab',
  display: 'swap',
});
const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans-tab',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://tabuara.com.br'),
  title: 'Tabuará — Gastronomia Sensorial · Aracaju',
  description:
    'Na Coroa do Meio, em Aracaju, a Tabuará é uma experiência de gastronomia sensorial: cozinha autoral, coquetelaria e carta de vinhos, num ambiente sofisticado. Reserve sua mesa ou peça delivery.',
  openGraph: {
    title: 'Tabuará — Gastronomia Sensorial · Aracaju',
    description:
      'Cozinha autoral, coquetelaria e carta de vinhos, num ambiente sofisticado na Coroa do Meio, em Aracaju.',
    type: 'website',
    locale: 'pt_BR',
    siteName: 'Tabuará',
    images: [{ url: '/tabuara/destaque-polvo.jpg', width: 1500, height: 1000 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tabuará — Gastronomia Sensorial · Aracaju',
    description: 'Cozinha autoral, coquetelaria e carta de vinhos na Coroa do Meio, em Aracaju.',
    images: ['/tabuara/destaque-polvo.jpg'],
  },
};

export default function TabuaraLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${serif.variable} ${sans.variable}`}>{children}</div>;
}
