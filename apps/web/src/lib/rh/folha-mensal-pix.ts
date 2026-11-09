// Folha mensal paga por Pix pelo sistema (pedido do dono 05/11/2026: "não
// aparece no lançamento dos Pix" / "como paga a folha?").
// As contas do botão "Lançar pagamentos da folha" (lib/rh/folha-contador-pagamentos.ts)
// nascem com origem FOLHA, e a folha fica fora de Pedidos Pix. Exceção, igual à
// rescisão: a conta da folha MENSAL do sistema (código "fc:<mês>:…" e
// observação "Folha do sistema …") entra. A folha semanal (folha_semana_id) e o
// borderô continuam de fora.
// Um Pix por conta, como o resto da tela: repasse E.B., repasse Lelis e cada
// salário pago direto pela casa. No salário direto, sem chave no cadastro, a
// chave é o CPF do funcionário (o mesmo do código da conta). No repasse nunca
// cai no CPF de ninguém: quem recebe é a E.B. ou a Lelis.
// 09/11/2026: o salário que a E.B. paga direto ao funcionário ("fe:…") e o
// complemento ("fec:…") também entram — antes não apareciam na tela.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { LELIS_CNPJ } from '@/lib/impostos/guia';

export interface FolhaMensalPix {
  contaId: string;
  /** CPF do funcionário (só dígitos) no salário direto; null no repasse. */
  cpf: string | null;
}

/** Contas (dentre as passadas) que são da folha mensal do sistema. */
export async function folhaMensalDasContas(contaIds: string[]): Promise<Map<string, FolhaMensalPix>> {
  const out = new Map<string, FolhaMensalPix>();
  if (contaIds.length === 0) return out;
  const lista = sql.join(
    contaIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    SELECT id::text AS id, codigo_referencia AS ref
      FROM conta_pagar
     WHERE id IN (${lista})
       AND origem = 'FOLHA'
       AND folha_semana_id IS NULL
       AND (
             (codigo_referencia LIKE 'fc:%' AND observacao LIKE 'Folha do sistema%')
          OR ((codigo_referencia LIKE 'fe:%' OR codigo_referencia LIKE 'fec:%')
              AND (observacao LIKE 'Folha do sistema%' OR observacao LIKE 'Complemento da folha do sistema%'))
       )
  `)) as unknown as Array<{ id: string; ref: string }>;
  for (const r of rows) {
    // fc:<AAAA-MM>:<CNPJ empregador>[:<CPF>] — com CPF e sem ser a Lelis = salário direto
    // fe:/fec:<AAAA-MM>:<casa 8>:<CPF> — salário (ou complemento) pago pela E.B. ao funcionário
    const [tipo, , cnpj, cpf] = r.ref.split(':');
    const direto = !!cpf && /^\d{11}$/.test(cpf) && (tipo !== 'fc' || cnpj !== LELIS_CNPJ);
    out.set(r.id, { contaId: r.id, cpf: direto ? cpf! : null });
  }
  return out;
}

/** Condição SQL: a conta é da folha mensal do sistema. */
export const sqlEhFolhaMensal = (c: { origem: unknown; folhaSemanaId: unknown; codigoReferencia: unknown; observacao: unknown }) =>
  sql`(${c.origem} = 'FOLHA' and ${c.folhaSemanaId} is null and (
    (${c.codigoReferencia} like 'fc:%' and ${c.observacao} like 'Folha do sistema%')
    or ((${c.codigoReferencia} like 'fe:%' or ${c.codigoReferencia} like 'fec:%')
        and (${c.observacao} like 'Folha do sistema%' or ${c.observacao} like 'Complemento da folha do sistema%'))
  ))`;
