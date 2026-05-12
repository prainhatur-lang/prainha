// Guard server-side: tudo sob /conciliacao/* exige 'conciliacao.read'.

import { exigirPermPage } from '@/lib/exigir-perm';

export default async function ConciliacaoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await exigirPermPage('conciliacao.read');
  return children;
}
