// POST /api/financeiro/contas/[id]/liberar-pagamento  { motivo }
// Autoriza pagar ANTES de a mercadoria chegar uma conta marcada "só depois que
// chegar" (dono 26/11/2026: "só pode ser paga depois que chegar a mercadoria ou
// que já for autorizado"). Só o Admin autoriza; fica gravado quem, quando e o
// motivo. Não paga nada: só solta a trava de @/lib/conta-aguarda-mercadoria.
// DELETE desfaz a autorização (a conta volta a esperar a mercadoria), enquanto
// não foi paga.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { ehAdmin } from '@/lib/usuario-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ motivo: z.string().trim().min(3).max(300) });

async function carregar(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) } as const;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { erro: NextResponse.json({ error: 'id inválido' }, { status: 400 }) } as const;
  if (!(await ehAdmin(user.id))) {
    return { erro: NextResponse.json({ error: 'Só o Admin autoriza pagar antes de a mercadoria chegar.' }, { status: 403 }) } as const;
  }
  const c = schema.contaPagar;
  const [conta] = await db
    .select({ id: c.id, soAposChegar: c.soAposChegar, dataPagamento: c.dataPagamento, dataDelete: c.dataDelete })
    .from(c)
    .where(eq(c.id, id))
    .limit(1);
  if (!conta || conta.dataDelete) return { erro: NextResponse.json({ error: 'conta não encontrada' }, { status: 404 }) } as const;
  if (!conta.soAposChegar) {
    return { erro: NextResponse.json({ error: 'esta conta não está esperando mercadoria' }, { status: 400 }) } as const;
  }
  if (conta.dataPagamento) return { erro: NextResponse.json({ error: 'conta já paga' }, { status: 400 }) } as const;
  return { user, conta } as const;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await carregar(id);
  if ('erro' in r) return r.erro;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Diga o motivo da autorização.' }, { status: 400 });
  await db
    .update(schema.contaPagar)
    .set({ liberadaEm: new Date(), liberadaPor: r.user.id, liberadaMotivo: parsed.data.motivo })
    .where(eq(schema.contaPagar.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await carregar(id);
  if ('erro' in r) return r.erro;
  await db
    .update(schema.contaPagar)
    .set({ liberadaEm: null, liberadaPor: null, liberadaMotivo: null })
    .where(eq(schema.contaPagar.id, id));
  return NextResponse.json({ ok: true });
}
