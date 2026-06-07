// Lógica do lembrete de confirmação de reserva (véspera). Compartilhada entre
// o cron (/api/cron/lembrete-reserva) e o botão manual no painel (/reservas).

import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { lembreteReservaConfigurado, enviarLembreteReserva } from '@/lib/whatsapp-otp';

function normTelefone(v: string | null): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) d = '55' + d;
  return d;
}

export interface ResultadoLembrete {
  configurado: boolean;
  data: string;
  total: number;
  enviados: number;
  semTelefone: number;
  falhas: string[];
}

/**
 * Manda o lembrete de confirmação pras reservas de `dataIso` (YYYY-MM-DD) que
 * estão ativas (pendente/confirmada), com telefone e ainda sem lembrete.
 * `escopoFilial` (opcional) limita às filiais informadas (pro botão manual).
 */
export async function processarLembretesReserva(
  dataIso: string,
  escopoFilial?: string[],
): Promise<ResultadoLembrete> {
  if (!lembreteReservaConfigurado()) {
    return { configurado: false, data: dataIso, total: 0, enviados: 0, semTelefone: 0, falhas: [] };
  }

  const reservas = await db
    .select({
      id: schema.reserva.id,
      nome: schema.reserva.clienteNome,
      telefone: schema.reserva.clienteTelefone,
      data: schema.reserva.data,
      hora: schema.reserva.hora,
      area: schema.reserva.area,
      cancelToken: schema.reserva.cancelToken,
      filialId: schema.reserva.filialId,
      filialNome: schema.filial.nome,
    })
    .from(schema.reserva)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.reserva.filialId))
    .where(
      and(
        eq(schema.reserva.data, dataIso),
        inArray(schema.reserva.status, ['pendente', 'confirmada']),
        isNull(schema.reserva.lembreteConfirmacaoEm),
        sql`${schema.reserva.clienteTelefone} IS NOT NULL`,
        escopoFilial && escopoFilial.length
          ? inArray(schema.reserva.filialId, escopoFilial)
          : sql`true`,
      ),
    );

  let enviados = 0;
  let semTelefone = 0;
  const falhas: string[] = [];

  for (const r of reservas) {
    const tel = normTelefone(r.telefone);
    if (!tel) {
      semTelefone++;
      continue;
    }
    let token = r.cancelToken;
    if (!token) {
      token = randomBytes(24).toString('hex');
      await db.update(schema.reserva).set({ cancelToken: token }).where(eq(schema.reserva.id, r.id));
    }
    const [a, m, d] = r.data.split('-');
    try {
      await enviarLembreteReserva(tel, {
        nome: (r.nome ?? '').split(' ')[0] || 'tudo bem',
        data: `${d}/${m}/${a}`,
        hora: r.hora,
        local: `${r.filialNome}${r.area ? ' · ' + r.area : ''}`,
        token,
      });
      await db
        .update(schema.reserva)
        .set({ lembreteConfirmacaoEm: sql`now()` })
        .where(eq(schema.reserva.id, r.id));
      enviados++;
    } catch (e) {
      falhas.push(`${r.nome}: ${(e as Error).message}`);
    }
  }

  return { configurado: true, data: dataIso, total: reservas.length, enviados, semTelefone, falhas };
}
