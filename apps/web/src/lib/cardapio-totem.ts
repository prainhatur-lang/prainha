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

// ---- ONDE VENDE (cadastro do produto, aba PDV — 02/11/2026) ----
// Liga/desliga UM tamanho no totem ou no 🎟 Ticket da maquininha sem mexer no
// resto da lista. O totem continua sendo a mesma tabela da tela /cardapio/totem.

/** Põe (grupo) ou tira (null) um tamanho do totem. Entrando, vai pro fim do grupo. */
export async function marcarTotem(filialId: string, codigo: number, grupo: GrupoTotem | null, quem: string | null) {
  if (grupo == null) {
    await db.execute(sql`DELETE FROM totem_item WHERE filial_id = ${filialId} AND codigo = ${codigo}`);
    return;
  }
  await db.execute(sql`
    INSERT INTO totem_item (filial_id, codigo, grupo, ordem, atualizado_por)
    VALUES (${filialId}, ${codigo}, ${grupo},
      (SELECT COALESCE(max(ordem), -1) + 1 FROM totem_item WHERE filial_id = ${filialId} AND grupo = ${grupo}),
      ${quem})
    ON CONFLICT (filial_id, codigo) DO UPDATE
      SET grupo = EXCLUDED.grupo, ativo = true, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now(),
          ordem = CASE WHEN totem_item.grupo = EXCLUDED.grupo THEN totem_item.ordem ELSE EXCLUDED.ordem END`);
}

/** Códigos de PDV que a maquininha mostra no 🎟 Ticket. Vazio = mostra tudo. */
export async function listarTicket(filialId: string): Promise<number[]> {
  try {
    const rows = (await db.execute(sql`
      SELECT codigo FROM ticket_item WHERE filial_id = ${filialId} ORDER BY codigo`)) as unknown as Array<{ codigo: number }>;
    return rows.map((r) => Number(r.codigo)).filter((n) => n > 0);
  } catch {
    return []; // tabela ainda não existe
  }
}

export async function marcarTicket(filialId: string, codigo: number, vende: boolean, quem: string | null) {
  if (!vende) {
    await db.execute(sql`DELETE FROM ticket_item WHERE filial_id = ${filialId} AND codigo = ${codigo}`);
    return;
  }
  await db.execute(sql`
    INSERT INTO ticket_item (filial_id, codigo, atualizado_por) VALUES (${filialId}, ${codigo}, ${quem})
    ON CONFLICT (filial_id, codigo) DO UPDATE SET atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`);
}

// ---- SAI NA RECEPÇÃO (02/11/2026) ----
// Tamanho marcado que é vendido no 🎟 Ticket ou no totem vai pra praça
// RECEPÇÃO do tablet (a bebida da geladeira da recepção). Venda na mesa não
// muda. A praça nasce sozinha em `area_producao` na primeira marcação, com o
// próximo código livre da casa — é a lista que a loja já puxa pro KDS.

/** Códigos de PDV que saem na Recepção. */
export async function listarRecepcao(filialId: string): Promise<number[]> {
  try {
    const rows = (await db.execute(sql`
      SELECT codigo FROM recepcao_item WHERE filial_id = ${filialId} ORDER BY codigo`)) as unknown as Array<{ codigo: number }>;
    return rows.map((r) => Number(r.codigo)).filter((n) => n > 0);
  } catch {
    return []; // tabela ainda não existe
  }
}

/** Código da praça Recepção da casa (cria se não houver). */
export async function garantirPracaRecepcao(filialId: string): Promise<number> {
  const achar = async () => {
    const rows = (await db.execute(sql`
      SELECT codigo_externo FROM area_producao
      WHERE filial_id = ${filialId}
        AND translate(lower(nome), 'çãáâéêíóôõú', 'caaaeeiooou') LIKE 'recepcao%'
      ORDER BY ativa DESC, codigo_externo LIMIT 1`)) as unknown as Array<{ codigo_externo: number }>;
    return rows[0] ? Number(rows[0].codigo_externo) : null;
  };
  const tem = await achar();
  if (tem != null) {
    await db.execute(sql`UPDATE area_producao SET ativa = true WHERE filial_id = ${filialId} AND codigo_externo = ${tem} AND ativa = false`);
    return tem;
  }
  await db.execute(sql`
    INSERT INTO area_producao (filial_id, codigo_externo, nome, ativa)
    VALUES (${filialId},
      (SELECT COALESCE(max(codigo_externo), 0) + 1 FROM area_producao WHERE filial_id = ${filialId}),
      'RECEPÇÃO', true)
    ON CONFLICT (filial_id, codigo_externo) DO NOTHING`);
  return (await achar()) ?? 0;
}

export async function marcarRecepcao(filialId: string, codigo: number, sai: boolean, quem: string | null) {
  if (!sai) {
    await db.execute(sql`DELETE FROM recepcao_item WHERE filial_id = ${filialId} AND codigo = ${codigo}`);
    return;
  }
  await garantirPracaRecepcao(filialId);
  await db.execute(sql`
    INSERT INTO recepcao_item (filial_id, codigo, atualizado_por) VALUES (${filialId}, ${codigo}, ${quem})
    ON CONFLICT (filial_id, codigo) DO UPDATE SET atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`);
}
