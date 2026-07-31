// Guard server-side: tudo sob /folha-equipe/* exige 'folha_equipe.read'.

import { exigirPermPage } from '@/lib/exigir-perm';

export default async function FolhaEquipeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await exigirPermPage('folha_equipe.read');
  return children;
}
