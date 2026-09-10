// Puxador único do iFood: um ciclo a cada 30s, pela nuvem.
//
// O cron do Vercel é de minuto em minuto, e o iFood manda puxar a cada 30s (e
// bloqueia com 429 quem puxa mais rápido que isso por token). Então cada
// invocação faz DOIS ciclos, com 30s de intervalo, e sai antes do minuto
// virar. É por isso que existe o lease em ifood_nuvem_lease: se duas
// invocações se cruzarem, a segunda não puxa — dividir a fila é justamente o
// bug que este desenho evita.
//
// Casa com `puxador: loja` continua puxando sozinha; a nuvem nem toca no
// client_id dela. A virada é a chave na tela de configuração.

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { cicloPuxador, soltarLeases } from '@/lib/ifood-puxador';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ESPERA_MS = 30_000;

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  }

  const dono = randomUUID().slice(0, 8);
  const ciclos = [];
  try {
    const primeiro = await cicloPuxador(dono);
    ciclos.push(primeiro);
    // Nenhuma casa em `puxador: nuvem` (ou nenhuma credencial cadastrada):
    // não faz sentido segurar a função 30s esperando pra não puxar de novo.
    if (primeiro.length) {
      await new Promise((r) => setTimeout(r, ESPERA_MS));
      ciclos.push(await cicloPuxador(dono));
    }
  } finally {
    // Solta a trava na saída: a invocação do próximo minuto não pode esperar
    // os 50s do lease vencerem pra começar.
    await soltarLeases(dono).catch(() => {});
  }

  return NextResponse.json({ ok: true, dono, ciclos });
}
