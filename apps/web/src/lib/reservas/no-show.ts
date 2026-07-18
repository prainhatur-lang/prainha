// Cancelamento automático de reserva por no-show: se o cliente não chegou
// até TOLERANCIA_MIN depois do horário marcado, a mesa é liberada sozinha
// (status vira 'no_show', que já é excluído da ocupação em mesa-disponivel.ts)
// e o cliente recebe um aviso no WhatsApp. Compartilhado entre o cron
// (/api/cron/no-show-automatico) e qualquer chamada manual futura.

import { db, schema } from '@concilia/db';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';
import { enviarAtualizacaoReserva } from '@/lib/whatsapp-otp';

export const TOLERANCIA_NO_SHOW_MIN = 20;

export interface ResultadoNoShow {
  total: number;
  marcados: number;
  falhas: string[];
}

export async function processarNoShowAutomatico(): Promise<ResultadoNoShow> {
  const agora = Date.now();

  // Só precisa olhar reservas de hoje pra trás — datas futuras nunca vão
  // bater o corte. status ativo = ainda "esperando" o cliente chegar.
  const candidatas = await db
    .select({
      id: schema.reserva.id,
      nome: schema.reserva.clienteNome,
      telefone: schema.reserva.clienteTelefone,
      data: schema.reserva.data,
      hora: schema.reserva.hora,
      cancelToken: schema.reserva.cancelToken,
    })
    .from(schema.reserva)
    .where(
      and(
        inArray(schema.reserva.status, ['pendente', 'confirmada']),
        lte(schema.reserva.data, hojeBr()),
      ),
    );

  let marcados = 0;
  const falhas: string[] = [];

  for (const r of candidatas) {
    const cortMs = new Date(`${r.data}T${r.hora}:00-03:00`).getTime() + TOLERANCIA_NO_SHOW_MIN * 60 * 1000;
    if (agora <= cortMs) continue;

    try {
      await db.update(schema.reserva).set({ status: 'no_show' }).where(eq(schema.reserva.id, r.id));
      marcados++;

      if (r.telefone) {
        const [a, m, d] = r.data.split('-');
        await enviarAtualizacaoReserva(r.telefone, {
          nome: r.nome,
          mensagem: `Sua reserva de ${d}/${m}/${a} às ${r.hora} foi cancelada automaticamente — passou dos ${TOLERANCIA_NO_SHOW_MIN} minutos de tolerância sem você chegar. Se quiser, é só fazer uma nova reserva ou chamar a gente por aqui! 🌅`,
        });
      }
    } catch (e) {
      falhas.push(`${r.nome} (${r.id}): ${(e as Error).message}`);
    }
  }

  return { total: candidatas.length, marcados, falhas };
}
