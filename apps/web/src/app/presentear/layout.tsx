import { Playfair_Display, Inter } from 'next/font/google';

const serif = Playfair_Display({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-serif-vp', display: 'swap' });
const sans = Inter({ subsets: ['latin'], variable: '--font-sans-vp', display: 'swap' });

export default function PresentearLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${serif.variable} ${sans.variable}`}>{children}</div>;
}
