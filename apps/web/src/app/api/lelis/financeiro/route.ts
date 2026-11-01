// /api/lelis/financeiro — contas a pagar e a receber da Lelis (01/11/2026).
// GET: as duas listas. POST: baixa (pago/recebido) ou desfaz a baixa.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { acessoLelisApi } from '@/lib/lelis/acesso';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const pagar = await db.execute(sql`
    SELECT c.id, c.descricao, c.parcela, c.total_parcelas, c.data_vencimento::text AS vencimento,
           c.valor::float AS valor, c.data_pagamento::text AS pago_em, c.valor_pago::float AS valor_pago,
           coalesce(f.nome, n.emit_nome) AS fornecedor
      FROM conta_pagar c
      LEFT JOIN fornecedor f ON f.id = c.fornecedor_id
      LEFT JOIN nota_compra n ON n.id = c.nota_compra_id
     WHERE c.filial_id = ${a.filialId}::uuid
     ORDER BY (c.data_pagamento IS NOT NULL), c.data_vencimento
     LIMIT 300
  `);
  const receber = await db.execute(sql`
    SELECT id, comprador_nome, comprador_doc, descricao, parcela::int, total_parcelas::int, vencimento::text,
           valor::float, forma_pagamento, recebido_em::text, valor_recebido::float, cancelado
      FROM revenda_receber
     WHERE filial_id = ${a.filialId}::uuid
     ORDER BY cancelado, (recebido_em IS NOT NULL), vencimento
     LIMIT 300
  `);
  return NextResponse.json({ pagar, receber });
}

const Body = z.object({
  tipo: z.enum(['pagar', 'receber']),
  id: z.string().uuid(),
  /** null = desfaz a baixa */
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  valor: z.number().positive().optional(),
});

export async function POST(req: Request) {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const { tipo, id, data, valor } = p.data;
  const r =
    tipo === 'pagar'
      ? await db.execute(sql`
          UPDATE conta_pagar
             SET data_pagamento = ${data}::date,
                 valor_pago = CASE WHEN ${data}::date IS NULL THEN NULL ELSE coalesce(${valor ?? null}::numeric, valor) END
           WHERE id = ${id}::uuid AND filial_id = ${a.filialId}::uuid
          RETURNING id`)
      : await db.execute(sql`
          UPDATE revenda_receber
             SET recebido_em = ${data}::date,
                 valor_recebido = CASE WHEN ${data}::date IS NULL THEN NULL ELSE coalesce(${valor ?? null}::numeric, valor) END,
                 recebido_por = ${a.email}
           WHERE id = ${id}::uuid AND filial_id = ${a.filialId}::uuid AND NOT cancelado
          RETURNING id`);
  if (!(r as unknown as unknown[]).length) return NextResponse.json({ error: 'conta não encontrada' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
