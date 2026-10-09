// Recibo do convite do Cliente VIP: a Meta aceitar o envio não quer dizer que
// a mensagem chegou. O webhook traz depois o status de cada mensagem (enviada,
// entregue, lida ou recusada) — aqui ele é gravado no cartão, casado pelo id
// da mensagem guardado na hora do envio.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

const MAPA: Record<string, string> = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'erro' };
const ORDEM = ['enviada', 'entregue', 'lida'];

export async function registrarStatusConvite(wamid: string, status: string, erro: string | null): Promise<void> {
  const novo = MAPA[status];
  if (!novo) return;
  if (novo === 'erro') {
    await db.execute(sql`
      UPDATE fidelidade_cartao
      SET convite_status = 'erro', convite_status_em = now(), convite_erro = ${erro || 'a Meta não entregou o convite'}
      WHERE convite_wamid = ${wamid}`);
    return;
  }
  // os avisos chegam fora de ordem: "lida" não volta pra "entregue"
  const anteriores = ORDEM.slice(0, ORDEM.indexOf(novo));
  await db.execute(sql`
    UPDATE fidelidade_cartao
    SET convite_status = ${novo}, convite_status_em = now()
    WHERE convite_wamid = ${wamid}
      AND (convite_status IS NULL OR convite_status IN (${sql.join(anteriores.length ? anteriores.map((a) => sql`${a}`) : [sql`''`], sql`, `)}))`);
}
