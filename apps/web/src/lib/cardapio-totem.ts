// Cardápio do TOTEM de autoatendimento (tabela totem_item, 01/11/2026): a tela
// de toque da recepção da Prainha Bar. Cardápio resumido e só dele — cada
// linha liga uma variante (código do PDV) a um grupo da tela.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export const GRUPOS_TOTEM = [
  { id: 'cerveja', nome: 'Cervejas', emoji: '🍺' },
  { id: 'drinks', nome: 'Drinks e doses', emoji: '🍹' },
  { id: 'sem_alcool', nome: 'Sem álcool', emoji: '🥥' },
] as const;
export type GrupoTotem = (typeof GRUPOS_TOTEM)[number]['id'];
export const GRUPO_IDS = GRUPOS_TOTEM.map((g) => g.id) as unknown as [GrupoTotem, ...GrupoTotem[]];

export type TotemItem = { codigo: number; grupo: GrupoTotem; ordem: number };

export async function listarTotem(filialId: string): Promise<TotemItem[]> {
  try {
    const rows = (await db.execute(sql`
      SELECT codigo, grupo, ordem FROM totem_item
       WHERE filial_id = ${filialId} AND ativo
       ORDER BY grupo, ordem, codigo`)) as unknown as Array<{ codigo: number; grupo: string; ordem: number }>;
    return rows
      .filter((r) => (GRUPO_IDS as string[]).includes(r.grupo))
      .map((r) => ({ codigo: Number(r.codigo), grupo: r.grupo as GrupoTotem, ordem: Number(r.ordem) || 0 }));
  } catch {
    return []; // tabela ainda não existe
  }
}

/** Troca o cardápio inteiro do totem da casa pelo que veio da tela. */
export async function salvarTotem(filialId: string, itens: TotemItem[], quem: string | null): Promise<number> {
  const vistos = new Set<number>();
  const lista = itens.filter((i) => {
    if (vistos.has(i.codigo)) return false;
    vistos.add(i.codigo);
    return true;
  });
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM totem_item WHERE filial_id = ${filialId}`);
    for (const i of lista) {
      await tx.execute(sql`
        INSERT INTO totem_item (filial_id, codigo, grupo, ordem, atualizado_por)
        VALUES (${filialId}, ${i.codigo}, ${i.grupo}, ${i.ordem}, ${quem})`);
    }
  });
  return lista.length;
}
