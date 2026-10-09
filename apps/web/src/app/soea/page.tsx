// soea.prainhabar.com — benefício da 81ª SOEA. Tudo em @/components/evento/pagina.

import { EVENTOS } from '@/lib/eventos';
import { PaginaEvento } from '@/components/evento/pagina';

export const dynamic = 'force-dynamic';

export default function SoeaPage() {
  return <PaginaEvento ev={EVENTOS.soea} />;
}
