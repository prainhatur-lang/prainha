// Helpers server-side do módulo de orçamentos.

import { db, schema } from '@concilia/db';
import { inArray } from 'drizzle-orm';
import type { LocalOpt } from '@/lib/orcamentos';

/**
 * Monta as opções de local do evento: cada filial acessível + os ambientes
 * marcados somenteEventos na reservaConfig dela (ex: Terraço no Prainha Bar).
 * Hoje dá 4 opções: Prainha Bar, Terraço, Prainha Mar e Tabuará.
 */
export async function montarLocaisEvento(
  filiais: Array<{ id: string; nome: string }>,
): Promise<LocalOpt[]> {
  if (filiais.length === 0) return [];
  const configs = await db
    .select({ id: schema.filial.id, reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(inArray(schema.filial.id, filiais.map((f) => f.id)));
  const areasPorFilial = new Map(configs.map((c) => [c.id, c.reservaConfig?.areas ?? []]));

  const locais: LocalOpt[] = [];
  for (const f of filiais) {
    locais.push({ filialId: f.id, local: null, label: f.nome });
    for (const a of areasPorFilial.get(f.id) ?? []) {
      if (a.somenteEventos) {
        locais.push({ filialId: f.id, local: a.nome, label: `${a.nome} (${f.nome})` });
      }
    }
  }
  return locais;
}
