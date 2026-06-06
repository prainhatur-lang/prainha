// POST /api/cotacao/[id]/enviar-whatsapp
// Marca o convite de um fornecedor como enviado (link_enviado_em = now).
// Body: { cotacaoFornecedorId }

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cotacao.update');
  if (semPerm) return semPerm;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const cfId = typeof body?.cotacaoFornecedorId === 'string' ? body.cotacaoFornecedorId : '';
  if (!cfId) return NextResponse.json({ error: 'cotacaoFornecedorId obrigatorio' }, { status: 400 });

  const r = await db
    .update(schema.cotacaoFornecedor)
    .set({ linkEnviadoEm: new Date() })
    .where(
      and(
        eq(schema.cotacaoFornecedor.id, cfId),
        eq(schema.cotacaoFornecedor.cotacaoId, id),
      ),
    )
    .returning({ id: schema.cotacaoFornecedor.id });

  if (r.length === 0) return NextResponse.json({ error: 'convite nao encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
