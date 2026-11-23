// PATCH /api/financeiro/contas/[id]/forma-pagamento (23/11/2026)
// Body (qualquer combinação):
//  - forma: 'boleto' | 'pix' | null — forma DESTA conta, por cima da do
//    fornecedor (null = segue o fornecedor).
//  - mesmaDividaId: uuid | null — "é a mesma dívida" daquela conta (boleto ×
//    Pix). Paga uma, a outra não se paga de novo. null desfaz o vínculo.
//  - naoEMesmaDivida: true — conferido: a conta parecida NÃO é a mesma; some
//    o aviso e o Pix/baixa liberam.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';

export const dynamic = 'force-dynamic';

const Body = z.object({
  forma: z.enum(['boleto', 'pix']).nullable().optional(),
  mesmaDividaId: z.string().uuid().nullable().optional(),
  naoEMesmaDivida: z.literal(true).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const b = parsed.data;

  const c = schema.contaPagar;
  const [conta] = await db
    .select({ id: c.id, filialId: c.filialId, mesmaDividaId: c.mesmaDividaId })
    .from(c)
    .where(and(eq(c.id, id), isNull(c.dataDelete)))
    .limit(1);
  if (!conta) return NextResponse.json({ error: 'conta não encontrada' }, { status: 404 });
  const [acesso] = await db
    .select({ id: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, conta.filialId)))
    .limit(1);
  if (!acesso && !(await ebLiberadaNoFinanceiro(user.id, conta.filialId))) {
    return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });
  }

  const set: Partial<typeof c.$inferInsert> = {};
  if ('forma' in b) set.formaPagamento = b.forma ?? null;
  if (b.naoEMesmaDivida) set.gemeaConferidaEm = new Date();

  if ('mesmaDividaId' in b) {
    const outra = b.mesmaDividaId ?? null;
    if (outra) {
      if (outra === id) return NextResponse.json({ error: 'a conta não é gêmea dela mesma' }, { status: 400 });
      const [o] = await db
        .select({ id: c.id, filialId: c.filialId })
        .from(c)
        .where(and(eq(c.id, outra), isNull(c.dataDelete)))
        .limit(1);
      if (!o || o.filialId !== conta.filialId) {
        return NextResponse.json({ error: 'a outra conta não existe ou é de outra casa' }, { status: 400 });
      }
      set.mesmaDividaId = outra;
    } else {
      set.mesmaDividaId = null;
      // desfaz dos dois lados: a outra pode estar apontando pra esta
      if (conta.mesmaDividaId) {
        await db.update(c).set({ mesmaDividaId: null }).where(and(eq(c.id, conta.mesmaDividaId), eq(c.mesmaDividaId, id)));
      }
      await db.update(c).set({ mesmaDividaId: null }).where(eq(c.mesmaDividaId, id));
    }
  }

  if (Object.keys(set).length === 0 && !('mesmaDividaId' in b)) {
    return NextResponse.json({ error: 'nada pra mudar' }, { status: 400 });
  }
  if (Object.keys(set).length > 0) await db.update(c).set(set).where(eq(c.id, id));
  return NextResponse.json({ ok: true });
}
