// Comprador manda o vale QUITADO pra quem vai ganhar (página pública
// /presente/[token], caixa "Enviar pra quem vai ganhar") — 04/11/2026.
// POST { telefone?, email? } → grava o contato e tenta o WhatsApp oficial.
// { enviado:false } = a página cai no wa.me do próprio comprador.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { valePorToken } from '@/lib/vale-presente';
import { emailValido, entregarValeAoPresenteado, foneWhatsApp } from '@/lib/vale-presente-entrega';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: bruto } = await params;
  const token = decodeURIComponent(bruto ?? '').replace(/^(\{\{\d+\}\})+/, '');
  const v = await valePorToken(token);
  if (!v) return NextResponse.json({ error: 'vale não encontrado' }, { status: 404 });
  if (v.status !== 'pago') return NextResponse.json({ enviado: false, motivo: 'vale não está pago' }, { status: 409 });
  if (v.presenteadoAvisadoEm) return NextResponse.json({ enviado: true, motivo: 'já entregue' });

  const body = (await request.json().catch(() => ({}))) as { telefone?: unknown; email?: unknown };
  const tel = typeof body.telefone === 'string' && body.telefone.trim() ? foneWhatsApp(body.telefone) : null;
  const email = typeof body.email === 'string' && body.email.trim() ? emailValido(body.email) : null;
  if (typeof body.telefone === 'string' && body.telefone.trim() && !tel) {
    return NextResponse.json({ error: 'WhatsApp inválido — com DDD' }, { status: 400 });
  }

  const muda: Partial<typeof schema.valePresente.$inferInsert> = {};
  if (tel && tel !== v.presenteadoTelefone) muda.presenteadoTelefone = tel;
  if (email && email !== v.presenteadoEmail) muda.presenteadoEmail = email;
  let atual = v;
  if (Object.keys(muda).length) {
    const [novo] = await db.update(schema.valePresente).set(muda).where(eq(schema.valePresente.id, v.id)).returning();
    if (novo) atual = novo;
  }
  if (!atual.presenteadoTelefone) return NextResponse.json({ enviado: false, motivo: 'sem WhatsApp' });

  try {
    return NextResponse.json(await entregarValeAoPresenteado(atual));
  } catch (e) {
    console.error('[presente] entrega ao presenteado falhou:', (e as Error).message);
    return NextResponse.json({ enviado: false, motivo: 'falha ao enviar' });
  }
}
