// tabuara.com.br/soea — benefício da 81ª SOEA na Tabuará (Cliente VIP Tabuará).
// Tudo em @/components/evento/pagina.

import { EVENTOS } from '@/lib/eventos';
import { PaginaEvento } from '@/components/evento/pagina';

export const dynamic = 'force-dynamic';

export default function TabuaraSoeaPage() {
  return <PaginaEvento ev={EVENTOS.tabuaraSoea} />;
}
