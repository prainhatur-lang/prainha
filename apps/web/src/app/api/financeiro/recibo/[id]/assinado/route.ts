// POST /api/financeiro/recibo/[id]/assinado — sobe o recibo impresso e
// assinado (foto ou PDF) de uma conta. multipart/form-data com 'arquivo'.
// Pode subir mais de um (frente/verso, foto melhor); nada é apagado.
// GET devolve a lista dos guardados.

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { guardarReciboAssinado, listarRecibosAssinados } from '@/lib/recibo-assinado';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function contaComAcesso(id: string, perm: 'conta_pagar.create' | 'conta_pagar.read') {
  const { user, error } = await exigirPermApi(perm);
  if (error) return { erro: error };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { erro: NextResponse.json({ error: 'id invalido' }, { status: 400 }) };
  const [conta] = await db
    .select({ id: schema.contaPagar.id, filialId: schema.contaPagar.filialId, dataDelete: schema.contaPagar.dataDelete })
    .from(schema.contaPagar)
    .where(eq(schema.contaPagar.id, id))
    .limit(1);
  if (!conta || conta.dataDelete) return { erro: NextResponse.json({ error: 'conta não encontrada' }, { status: 404 }) };
  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, conta.filialId)))
    .limit(1);
  if (!acesso && !(await ebLiberadaNoFinanceiro(user.id, conta.filialId))) {
    return { erro: NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 }) };
  }
  return { conta };
}

// GET — lista dos guardados (a tela confere a cada poucos segundos se chegou
// a foto tirada pelo celular).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await contaComAcesso((await ctx.params).id, 'conta_pagar.read');
  if (r.erro) return r.erro;
  return NextResponse.json({ arquivos: await listarRecibosAssinados(r.conta.filialId, r.conta.id) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await contaComAcesso((await ctx.params).id, 'conta_pagar.create');
  if (r.erro) return r.erro;
  const conta = r.conta;

  const form = await req.formData().catch(() => null);
  const falha = await guardarReciboAssinado(conta.filialId, conta.id, form?.get('arquivo'));
  if (falha) return NextResponse.json({ error: falha.erro }, { status: falha.status });

  return NextResponse.json({ ok: true, arquivos: await listarRecibosAssinados(conta.filialId, conta.id) }, { status: 201 });
}
