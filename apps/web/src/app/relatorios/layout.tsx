// Guard server-side: tudo sob /relatorios/* exige 'relatorio.read'.

import { exigirPermPage } from '@/lib/exigir-perm';

export default async function RelatoriosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await exigirPermPage('relatorio.read');
  return children;
}
