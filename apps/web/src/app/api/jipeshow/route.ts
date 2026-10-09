// Cadastro público do benefício de evento (jipeshow.prainhabar.com). Regras e
// contrato em @/lib/evento-cadastro.

import { EVENTOS } from '@/lib/eventos';
import { cadastrarNoEvento } from '@/lib/evento-cadastro';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  return cadastrarNoEvento(EVENTOS.jipeshow, req);
}
