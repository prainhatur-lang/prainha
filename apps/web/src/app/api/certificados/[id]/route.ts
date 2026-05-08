// PATCH /api/certificados/[id]
// Atualiza flags do certificado existente (sem precisar re-upload do PFX).
// Por enquanto: compartilharOrganizacao.
//
// Body: { compartilharOrganizacao?: boolean }

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  let body: { compartilharOrganizacao?: boolean };
  try {
    body = (await req.json()) as { compartilharOrganizacao?: boolean };
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }

  // RBAC: usuario tem que ser DONO da filial dona do cert
  const [cert] = await db
    .select({ filialId: schema.certificadoFilial.filialId })
    .from(schema.certificadoFilial)
    .where(eq(schema.certificadoFilial.id, id))
    .limit(1);
  if (!cert) return NextResponse.json({ error: 'cert nao encontrado' }, { status: 404 });

  const [link] = await db
    .select({ role: schema.usuarioFilial.role })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, cert.filialId),
      ),
    )
    .limit(1);
  if (!link || link.role !== 'DONO') {
    return NextResponse.json({ error: 'apenas DONO pode editar cert' }, { status: 403 });
  }

  const updates: Partial<typeof schema.certificadoFilial.$inferInsert> = {};
  if (typeof body.compartilharOrganizacao === 'boolean') {
    updates.compartilharOrganizacao = body.compartilharOrganizacao;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'nenhum campo pra atualizar' }, { status: 400 });
  }

  const result = await db
    .update(schema.certificadoFilial)
    .set(updates)
    .where(eq(schema.certificadoFilial.id, id))
    .returning({
      id: schema.certificadoFilial.id,
      compartilharOrganizacao: schema.certificadoFilial.compartilharOrganizacao,
    });

  return NextResponse.json({ ok: true, cert: result[0] });
}
