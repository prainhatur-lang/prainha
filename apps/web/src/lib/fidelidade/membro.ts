// "Esse telefone é Cliente VIP desta casa?" — usado pelos benefícios fora
// do Pix: prioridade na reserva e desconto no aluguel de espaço (orçamento).
// Casa pelos últimos 8 dígitos (mesmo critério da base de clientes), só no
// programa DA FILIAL (cada casa tem o seu Cliente VIP). Só conta cartão ativo e ADERIDO.

import { db, schema } from '@concilia/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { carregarPrograma } from './config';
import { estadoCartao } from './nucleo';

export interface Membro {
  cartaoId: string;
  casa: string;
  nome: string;
  nivel: string;
  nivelCodigo: string;
  cor: string;
  pct: number;
  pctEspaco: number;
  prioridadeReserva: boolean;
}

export async function membroPorTelefone(filialId: string, telefone: string | null | undefined): Promise<Membro | null> {
  const dig = String(telefone ?? '').replace(/\D/g, '');
  if (dig.length < 8) return null;
  const chave = dig.slice(-8);
  const { ativo, config: cfg, casa } = await carregarPrograma(filialId);
  if (!ativo) return null;
  const [c] = await db
    .select()
    .from(schema.fidelidadeCartao)
    .where(and(
      eq(schema.fidelidadeCartao.filialId, filialId),
      eq(schema.fidelidadeCartao.status, 'ativo'),
      isNotNull(schema.fidelidadeCartao.aderidoEm),
      sql`right(${schema.fidelidadeCartao.telefone}, 8) = ${chave}::text`,
    ))
    .limit(1);
  if (!c) return null;
  const { nivel } = await estadoCartao(c, cfg);
  return {
    cartaoId: c.id,
    casa,
    nome: c.nome,
    nivel: nivel.nome,
    nivelCodigo: nivel.codigo,
    cor: nivel.cor,
    pct: nivel.pct,
    pctEspaco: nivel.pctEspaco,
    prioridadeReserva: nivel.prioridadeReserva,
  };
}

/** Membros (ativos e aderidos) entre vários telefones — pra marcar na lista
 *  de reservas. Devolve mapa últimos-8-dígitos → nome do nível. Não calcula
 *  o nível por visita (seria N consultas): mostra só "Cliente VIP". */
export async function membrosPorTelefones(filialId: string, telefones: Array<string | null | undefined>): Promise<Set<string>> {
  const chaves = [...new Set(telefones.map((t) => String(t ?? '').replace(/\D/g, '')).filter((t) => t.length >= 8).map((t) => t.slice(-8)))];
  if (!chaves.length) return new Set();
  const rows = (await db.execute(sql`
    SELECT DISTINCT right(fc.telefone, 8) AS chave
    FROM fidelidade_cartao fc
    WHERE fc.filial_id = ${filialId}::uuid AND fc.status = 'ativo' AND fc.aderido_em IS NOT NULL
      AND right(fc.telefone, 8) IN (${sql.join(chaves.map((c) => sql`${c}::text`), sql`, `)})
  `)) as unknown as Array<{ chave: string }>;
  return new Set(rows.map((r) => r.chave));
}

/** Desconto do Cliente VIP no aluguel de espaço (taxa do espaço +
 *  exclusividade) de um orçamento de evento. Calculado no servidor pelo
 *  telefone do cliente — o formulário não escolhe o valor. Null = não membro
 *  ou nada a descontar. */
export async function descontoEspacoMembro(
  filialId: string,
  telefone: string | null | undefined,
  taxaEspaco: number | null,
  taxaExclusividade: number | null,
): Promise<{ desconto: number; motivo: string } | null> {
  const base = (taxaEspaco ?? 0) + (taxaExclusividade ?? 0);
  if (base <= 0) return null;
  const m = await membroPorTelefone(filialId, telefone);
  if (!m || m.pctEspaco <= 0) return null;
  const desconto = Math.round(base * m.pctEspaco) / 100;
  return { desconto, motivo: `Cliente VIP ${m.casa} ${m.nivel} (${m.pctEspaco}% no espaço)`.slice(0, 120) };
}
