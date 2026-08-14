// Selos de restrição alimentar por produto do cardápio (sem glúten / sem
// lactose), confirmados pela cozinha. Alimenta a tela interna /cardapio
// (garçom consulta no celular, gestor edita) e futuramente o delivery.
//
// Tabela produto_restricao criada sob demanda (deploy sai antes de migration
// oficial — mesma tática de cotacao-exclusao). Leituras toleram não existir.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export interface Restricao {
  semGluten: boolean;
  semLactose: boolean;
  obs: string | null;
}

export async function garantirTabelaRestricao(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS produto_restricao (
      produto_id uuid PRIMARY KEY REFERENCES produto(id) ON DELETE CASCADE,
      sem_gluten boolean NOT NULL DEFAULT false,
      sem_lactose boolean NOT NULL DEFAULT false,
      obs text,
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  // OBRIGATÓRIO em tabela nova (regra da casa): sem RLS a anon key do
  // Supabase lê/escreve via PostgREST.
  await db.execute(sql`ALTER TABLE produto_restricao ENABLE ROW LEVEL SECURITY`);
}

/** Map produto_id -> restrição. Vazio se a tabela ainda não existe. */
export async function lerRestricoes(): Promise<Map<string, Restricao>> {
  const mapa = new Map<string, Restricao>();
  try {
    const rows = (await db.execute(
      sql`SELECT produto_id, sem_gluten, sem_lactose, obs FROM produto_restricao`,
    )) as unknown as Array<{
      produto_id: string;
      sem_gluten: boolean;
      sem_lactose: boolean;
      obs: string | null;
    }>;
    for (const r of rows) {
      mapa.set(r.produto_id, { semGluten: r.sem_gluten, semLactose: r.sem_lactose, obs: r.obs });
    }
  } catch {
    // tabela ainda não existe
  }
  return mapa;
}

export async function definirRestricao(
  produtoId: string,
  r: { semGluten: boolean; semLactose: boolean; obs?: string | null },
): Promise<void> {
  await garantirTabelaRestricao();
  await db.execute(sql`
    INSERT INTO produto_restricao (produto_id, sem_gluten, sem_lactose, obs, atualizado_em)
    VALUES (${produtoId}, ${r.semGluten}, ${r.semLactose}, ${r.obs ?? null}, now())
    ON CONFLICT (produto_id) DO UPDATE SET
      sem_gluten = excluded.sem_gluten,
      sem_lactose = excluded.sem_lactose,
      obs = excluded.obs,
      atualizado_em = now()
  `);
}
