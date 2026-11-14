// Folha SEMANAL paga por Pix pelo sistema, direto na conta Inter do funcionário
// (pedido do dono 14/11/2026, folha do Bar 02–08/11: "Lançar todos eles no
// pagamento por Pix, que já existe. E aí eu vou botar só o valor e fazer o
// pagamento." — era sábado e o lote de folha do Inter só aceita dia útil).
//
// A folha semanal continua FORA de Pedidos Pix, como sempre. Entra só quando:
//   1. a folha foi LIBERADA pra Pix (folha_semana.pix_liberado_em) — decisão do
//      dono, folha por folha; e
//   2. a conta está em aberto e fora de borderô; e
//   3. o CPF do funcionário tem conta no Inter em conta_inter_folha (uma só).
// O destino é a CONTA Inter do cadastro (agência 0001 + conta), nunca o CPF
// como chave (dono 10/11/2026). Quem não tem conta Inter não aparece: segue
// pro borderô da lotérica / caixa.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export interface FolhaSemanalPix {
  contaId: string;
  /** CPF do funcionário, só dígitos. */
  cpf: string;
  /** Nome como está na conta do Inter. */
  nome: string;
  /** Conta com dígito, só números ("444540598") — é o que vai pro banco. */
  conta: string;
  /** Como o Inter escreve ("44454059-8") — é o que aparece na tela. */
  contaFmt: string;
}

/** Texto do destino que fica na tela e no registro do Pix. */
export const destinoContaInter = (contaFmt: string) => `Conta Inter · ag. 0001 · conta ${contaFmt}`;

/** Contas (dentre as passadas) da folha semanal liberada pra Pix, com a conta Inter de quem recebe. */
export async function folhaSemanalPixDasContas(contaIds: string[]): Promise<Map<string, FolhaSemanalPix>> {
  const out = new Map<string, FolhaSemanalPix>();
  if (contaIds.length === 0) return out;
  const lista = sql.join(
    contaIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    SELECT cp.id::text AS id, ci.cpf AS cpf,
           min(ci.nome) AS nome,
           min(ci.conta) AS conta,
           count(DISTINCT regexp_replace(ci.conta, '[^0-9]', '', 'g'))::int AS contas
      FROM conta_pagar cp
      JOIN folha_semana fs ON fs.id = cp.folha_semana_id AND fs.pix_liberado_em IS NOT NULL
      JOIN fornecedor fo ON fo.id = cp.fornecedor_id
      JOIN conta_inter_folha ci ON ci.cpf = regexp_replace(coalesce(fo.cnpj_ou_cpf, ''), '[^0-9]', '', 'g')
     WHERE cp.id IN (${lista})
       AND cp.origem = 'FOLHA'
       AND cp.bordero_id IS NULL
     GROUP BY cp.id, ci.cpf
  `)) as unknown as Array<{ id: string; cpf: string; nome: string; conta: string; contas: number }>;
  for (const r of rows) {
    // Duas contas diferentes pro mesmo CPF (uma por empresa): não escolhe sozinho.
    if (Number(r.contas) !== 1) continue;
    const digitos = r.conta.replace(/\D/g, '');
    if (!/^\d{11}$/.test(r.cpf) || digitos.length < 3) continue;
    out.set(r.id, { contaId: r.id, cpf: r.cpf, nome: r.nome, conta: digitos, contaFmt: r.conta });
  }
  return out;
}

/** Condição SQL (consulta sobre conta_pagar): conta da folha semanal liberada pra Pix e com conta Inter. */
export const sqlEhFolhaSemanalPix = () =>
  sql`(conta_pagar.origem = 'FOLHA' and conta_pagar.folha_semana_id is not null
    and exists (select 1 from folha_semana fs_pix
                 where fs_pix.id = conta_pagar.folha_semana_id and fs_pix.pix_liberado_em is not null)
    and exists (select 1 from fornecedor fo_pix
                  join conta_inter_folha ci_pix
                    on ci_pix.cpf = regexp_replace(coalesce(fo_pix.cnpj_ou_cpf, ''), '[^0-9]', '', 'g')
                 where fo_pix.id = conta_pagar.fornecedor_id))`;
