// Rescisão paga por Pix pelo sistema (pedido do dono 26/10/2026).
// A conta da rescisão nasce com origem FOLHA (rota /api/rh/rescisao) e a folha
// fica fora de Pedidos Pix. Exceção: conta ligada a um termo de rescisão
// (funcionario_documento.conta_pagar_id) entra, e quando o cadastro de quem
// recebe não tem chave Pix, a chave é o CPF do próprio funcionário.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export interface RescisaoPix {
  contaId: string;
  /** CPF do funcionário, só dígitos (11) — vira a chave quando falta chave. */
  cpf: string | null;
}

/** Contas (dentre as passadas) que são pagamento de rescisão, com o CPF do funcionário. */
export async function rescisoesDasContas(contaIds: string[]): Promise<Map<string, RescisaoPix>> {
  const out = new Map<string, RescisaoPix>();
  if (contaIds.length === 0) return out;
  const rows = (await db.execute(sql`
    SELECT d.conta_pagar_id::text AS conta_id, regexp_replace(coalesce(f.cpf, ''), '[^0-9]', '', 'g') AS cpf
      FROM funcionario_documento d
      JOIN funcionario f ON f.id = d.funcionario_id
     WHERE d.conta_pagar_id IN (${sql.join(
       contaIds.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
       AND d.cancelado_em IS NULL
  `)) as unknown as Array<{ conta_id: string; cpf: string }>;
  for (const r of rows) {
    out.set(r.conta_id, { contaId: r.conta_id, cpf: r.cpf.length === 11 ? r.cpf : null });
  }
  return out;
}

/** Condição SQL: a conta é de rescisão (ligada a um termo na ficha). */
export const sqlEhRescisao = (contaIdCol: unknown) =>
  sql`exists (select 1 from funcionario_documento rd where rd.conta_pagar_id = ${contaIdCol} and rd.cancelado_em is null)`;
