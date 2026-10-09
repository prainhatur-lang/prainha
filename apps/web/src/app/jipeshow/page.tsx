// jipeshow.prainhabar.com — benefício do 27º Jipe Show de Sergipe (até 12/10/2026).
// Tudo em @/components/evento/pagina.

import { EVENTOS } from '@/lib/eventos';
import { PaginaEvento } from '@/components/evento/pagina';

export const dynamic = 'force-dynamic';

export default function JipeShowPage() {
  return <PaginaEvento ev={EVENTOS.jipeshow} />;
}
