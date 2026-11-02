// Gravador das chamadas à API do iFood feitas em HOMOLOGAÇÃO (loja de teste).
// Vira o arquivo de logs do chamado. Só é usado com o modo homologação ligado.

import { db, schema } from '@concilia/db';
import type { ChamadaIfood, CredIfood } from '@/lib/ifood-api';

/** Credencial que grava cada chamada no log da homologação. */
export function comLogHomolog<T extends CredIfood>(filialId: string, modulo: string, c: T): T {
  return {
    ...c,
    log: async (r: ChamadaIfood) => {
      await db.insert(schema.ifoodHomologLog).values({
        filialId,
        modulo,
        quando: r.quando,
        metodo: r.metodo.slice(0, 8),
        caminho: r.caminho,
        status: r.status,
        ms: r.ms,
        tentativa: r.tentativa,
        pedido: (r.pedido ?? null) as Record<string, unknown> | null,
        resposta: r.resposta,
      });
    },
  };
}
