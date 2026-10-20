// Pix pago pelo sistema (tela Pedidos a pagar por Pix → "Pagar Pix agora").
// Pedido do dono em 20/10/2026. A linha de pix_pagamento nasce ENVIANDO antes
// de chamar o Inter; o id dela vai como chave de idempotência. Conta que está
// num Pix ENVIANDO/APROVACAO/AGENDADO não entra em outro Pix pelo sistema
// (a baixa manual de sempre continua livre).

import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { recalcularAgregado } from '@/lib/conta-pagar-baixa';
import { hojeBr } from '@/lib/datas';

export const STATUS_PIX_ABERTO = ['ENVIANDO', 'APROVACAO', 'AGENDADO'] as const;

/**
 * Quem pode MANDAR dinheiro. Mais estreito que dar baixa
 * (conta_pagar.marcar_pago, que gerente também tem): permissão
 * conta_pagar.pagar_pix, ou grupo Admin enquanto ela não for criada.
 */
export async function podePagarPix(userId: string): Promise<boolean> {
  if (await podeUsuario(userId, 'conta_pagar.pagar_pix')) return true;
  const rows = (await db.execute(sql`
    SELECT 1 FROM usuario_grupo ug JOIN grupo_usuario g ON g.id = ug.grupo_id
     WHERE ug.usuario_id = ${userId}::uuid AND g.nome = 'Admin' LIMIT 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}

/** Ids de conta presos num Pix ainda sem desfecho (da filial). */
export async function contasEmPixAberto(filialId: string): Promise<Set<string>> {
  const rows = (await db.execute(sql`
    SELECT e->>'id' AS id
      FROM pix_pagamento p, jsonb_array_elements(p.conta_ids) e
     WHERE p.filial_id = ${filialId}::uuid
       AND (p.status IN ('ENVIANDO','APROVACAO','AGENDADO') OR (p.status = 'PAGO' AND p.baixado_em IS NULL))
  `)) as unknown as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

/**
 * Dá baixa nas contas de um Pix que saiu. Uma vez só (baixado_em). Baixa no
 * máximo o saldo que a conta ainda tem — se alguém deu baixa à mão no meio
 * tempo, não paga duas vezes no sistema.
 */
export async function baixarContasDoPix(pixId: string, dataPagamento?: string | null) {
  return db.transaction(async (tx) => {
    const marcado = (await tx.execute(sql`
      UPDATE pix_pagamento SET baixado_em = now(), atualizado_em = now(), status = 'PAGO'
       WHERE id = ${pixId}::uuid AND baixado_em IS NULL
       RETURNING filial_id, conta_ids, codigo_solicitacao, usuario_id
    `)) as unknown as Array<{
      filial_id: string;
      conta_ids: Array<{ id: string; valor: number }>;
      codigo_solicitacao: string | null;
      usuario_id: string | null;
    }>;
    const p = marcado[0];
    if (!p) return { baixadas: 0 };
    const data = dataPagamento && /^\d{4}-\d{2}-\d{2}$/.test(dataPagamento) ? dataPagamento : hojeBr();
    let baixadas = 0;
    for (const item of p.conta_ids) {
      const [conta] = await tx
        .select({ id: schema.contaPagar.id, valor: schema.contaPagar.valor })
        .from(schema.contaPagar)
        .where(and(eq(schema.contaPagar.id, item.id), eq(schema.contaPagar.filialId, p.filial_id)))
        .limit(1);
      if (!conta) continue;
      const jaPago = (
        await tx
          .select({ valor: schema.contaPagarBaixa.valor })
          .from(schema.contaPagarBaixa)
          .where(eq(schema.contaPagarBaixa.contaPagarId, item.id))
      ).reduce((s, x) => s + Number(x.valor), 0);
      const saldo = Number(conta.valor) - jaPago;
      const valor = Math.min(Number(item.valor), saldo);
      if (valor <= 0.005) continue;
      await tx.insert(schema.contaPagarBaixa).values({
        filialId: p.filial_id,
        contaPagarId: item.id,
        data,
        valor: valor.toFixed(2),
        observacao: `Pix enviado pelo sistema (Inter)${p.codigo_solicitacao ? ` cód ${p.codigo_solicitacao}` : ''}`,
        criadoPor: p.usuario_id,
      });
      await recalcularAgregado(item.id, Number(conta.valor), tx);
      baixadas += 1;
    }
    return { baixadas };
  });
}
