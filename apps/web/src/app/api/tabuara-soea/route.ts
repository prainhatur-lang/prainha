// Cadastro público do benefício da 81ª SOEA na Tabuará (tabuara.com.br/soea).
// Regras e contrato em @/lib/evento-cadastro.

import { EVENTOS } from '@/lib/eventos';
import { cadastrarNoEvento } from '@/lib/evento-cadastro';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  return cadastrarNoEvento(EVENTOS.tabuaraSoea, req);
}
