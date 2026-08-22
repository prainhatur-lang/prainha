// CADASTRO ÚNICO — quem é a pessoa por trás de um telefone/CPF.
//
// Existem duas listas da mesma gente: `cliente` (espelho do PDV, é quem tem
// conta corrente e fiado) e os contatos de reserva. Este módulo é o único
// lugar que decide a ligação, pra ela não ser adivinhada de novo em cada tela.
//
// Regra: só liga por chave FORTE (CPF ou telefone com 10+ dígitos) e só quando
// a chave aponta pra UM cliente na filial. Empate não liga — juntar a conta da
// pessoa errada é pior do que não juntar. Nunca por nome: há 2.186 nomes
// repetidos no cadastro do PDV.

import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';

/** Só os dígitos, no máximo os 10 últimos (celular BR com DDD, sem o 9 extra). */
export function chaveFone(tel?: string | null): string | null {
  const d = (tel ?? '').replace(/\D+/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}

export function chaveCpf(cpf?: string | null): string | null {
  const d = (cpf ?? '').replace(/\D+/g, '');
  return d.length === 11 || d.length === 14 ? d : null;
}

export type ClienteLigado = { id: string; por: 'cpf' | 'telefone' } | null;

/**
 * Acha o cliente do PDV dono deste telefone/CPF nesta filial.
 * Devolve null quando não acha OU quando acha mais de um (empate não liga).
 */
export async function acharCliente(
  filialId: string,
  dados: { telefone?: string | null; cpf?: string | null },
): Promise<ClienteLigado> {
  const cpf = chaveCpf(dados.cpf);
  if (cpf) {
    const r = await db
      .select({ id: schema.cliente.id })
      .from(schema.cliente)
      .where(and(
        eq(schema.cliente.filialId, filialId),
        sql`regexp_replace(coalesce(${schema.cliente.cpfOuCnpj}, ''), '[^0-9]', '', 'g') = ${cpf}`,
      ))
      .limit(2);
    if (r.length === 1) return { id: r[0].id, por: 'cpf' };
  }

  const fone = chaveFone(dados.telefone);
  if (fone) {
    const r = await db
      .select({ id: schema.cliente.id })
      .from(schema.cliente)
      .where(and(
        eq(schema.cliente.filialId, filialId),
        sql`right(regexp_replace(coalesce(${schema.cliente.telefone}, ''), '[^0-9]', '', 'g'), 10) = ${fone}`,
      ))
      .limit(2);
    if (r.length === 1) return { id: r[0].id, por: 'telefone' };
  }

  return null;
}

/**
 * Os campos de ligação pra jogar direto no insert da reserva.
 * Nunca estoura: reserva tem que ser criada mesmo se a busca falhar.
 */
export async function ligacaoDaReserva(
  filialId: string,
  dados: { telefone?: string | null; cpf?: string | null },
): Promise<{ clienteId?: string; clienteLigadoPor?: string }> {
  try {
    const c = await acharCliente(filialId, dados);
    return c ? { clienteId: c.id, clienteLigadoPor: c.por } : {};
  } catch {
    return {};
  }
}
