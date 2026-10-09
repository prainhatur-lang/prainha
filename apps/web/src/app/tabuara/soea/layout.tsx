import type { Metadata, Viewport } from 'next';

// As fontes vêm do layout da Tabuará (--font-serif-tab / --font-sans-tab); a
// página de evento lê --font-display-soea / --font-texto-soea.

const TITULO = 'Tabuará · 81ª SOEA — drink de boas-vindas e desconto na conta';
const DESCRICAO =
  'Participante da 81ª SOEA é convidado da Tabuará, na Coroa do Meio, em Aracaju: cadastre-se e ganhe um drink de boas-vindas e desconto na conta, de 13 a 18 de outubro.';

export const metadata: Metadata = {
  title: TITULO,
  description: DESCRICAO,
  openGraph: {
    title: TITULO,
    description: DESCRICAO,
    type: 'website',
    locale: 'pt_BR',
    siteName: 'Tabuará',
    images: [{ url: '/tabuara/destaque-polvo.jpg', width: 1500, height: 1000 }],
  },
  twitter: { card: 'summary_large_image', title: TITULO, description: DESCRICAO, images: ['/tabuara/destaque-polvo.jpg'] },
};

export const viewport: Viewport = { themeColor: '#0d0b09' };

export default function TabuaraSoeaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={
        {
          '--font-display-soea': 'var(--font-serif-tab)',
          '--font-texto-soea': 'var(--font-sans-tab)',
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
