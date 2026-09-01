// De onde sai o WhatsApp que a cotação e o pedido usam.
//
// Ordem: vendedor principal do fornecedor → qualquer vendedor dele →
// fornecedor.fone_whatsapp → fornecedor.fone_principal (último recurso, é o
// que o Consumer manda e costuma ser o FIXO da empresa).
//
// Existe porque o número se perdia toda semana: era gravado no fornecedor e o
// sync do Consumer devolvia o fixo na sincronização seguinte.

import { sql, type SQL } from 'drizzle-orm';
import { schema } from '@concilia/db';

/** Subconsulta com o WhatsApp do vendedor do fornecedor (principal primeiro). */
export function foneDoVendedor(fornecedorIdCol: SQL | unknown): SQL<string | null> {
  return sql<string | null>`(
    SELECT v.whatsapp FROM vendedor_fornecedor vf
    JOIN vendedor v ON v.id = vf.vendedor_id
    WHERE vf.fornecedor_id = ${fornecedorIdCol}
      AND v.ativo AND COALESCE(v.whatsapp, '') <> ''
    ORDER BY vf.principal DESC, v.atualizado_em DESC
    LIMIT 1
  )`;
}

/** O número final que a tela deve usar pra falar com o fornecedor. */
export function foneParaWhatsapp(): SQL<string | null> {
  return sql<string | null>`COALESCE(
    ${foneDoVendedor(schema.fornecedor.id)},
    NULLIF(${schema.fornecedor.foneWhatsapp}, ''),
    NULLIF(${schema.fornecedor.fonePrincipal}, '')
  )`;
}
