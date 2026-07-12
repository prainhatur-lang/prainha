// Checagem de conflito de mesa: uma mesa só pode estar em UMA reserva ativa
// (pendente|confirmada|sentada) por vez, no mesmo espaço/data. Usado tanto na
// criação manual (admin) quanto na edição/troca de mesa (recepção) e na
// alocação automática do fluxo público de reserva.

import { db, schema } from '@concilia/db';
import { and, eq, inArray, ne } from 'drizzle-orm';

const STATUS_ATIVOS = ['pendente', 'confirmada', 'sentada'];

/** Mesas ocupadas por reserva ativa num espaço/data. `excluirReservaId` serve
 *  pra edição: a própria reserva não deve "brigar" com sua mesa atual. */
export async function mesasOcupadas(params: {
  filialId: string;
  data: string;
  area: string;
  excluirReservaId?: string;
}): Promise<Set<string>> {
  const { filialId, data, area, excluirReservaId } = params;
  const condicoes = [
    eq(schema.reserva.filialId, filialId),
    eq(schema.reserva.data, data),
    eq(schema.reserva.area, area),
    inArray(schema.reserva.status, STATUS_ATIVOS),
  ];
  if (excluirReservaId) condicoes.push(ne(schema.reserva.id, excluirReservaId));

  const ativas = await db
    .select({ mesa: schema.reserva.mesa })
    .from(schema.reserva)
    .where(and(...condicoes));

  return new Set(ativas.filter((r) => r.mesa).map((r) => String(r.mesa).trim()));
}

/** Checa se uma mesa específica está livre pra uma reserva (nova ou edição). */
export async function mesaEstaLivre(params: {
  filialId: string;
  data: string;
  area: string;
  mesa: string;
  excluirReservaId?: string;
}): Promise<boolean> {
  const ocupadas = await mesasOcupadas(params);
  return !ocupadas.has(String(params.mesa).trim());
}
