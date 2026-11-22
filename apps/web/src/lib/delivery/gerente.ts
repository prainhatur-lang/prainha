// Quem pode cancelar pedido do delivery JÁ CONCLUÍDO: DONO ou GERENTE na casa
// do pedido (usuario_filial.role) — dono 22/11/2026 ('só supervisor, só
// gerente pode cancelar').

import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';

/** Casas (entre as dadas) em que o usuário é DONO ou GERENTE. */
export async function filiaisOndeEhGerente(userId: string, filialIds: string[]): Promise<string[]> {
  if (filialIds.length === 0) return [];
  const rows = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, userId),
        inArray(schema.usuarioFilial.filialId, filialIds),
        inArray(schema.usuarioFilial.role, ['DONO', 'GERENTE']),
      ),
    );
  return rows.map((r) => r.filialId);
}

export async function ehGerenteDaFilial(userId: string, filialId: string): Promise<boolean> {
  return (await filiaisOndeEhGerente(userId, [filialId])).length > 0;
}
