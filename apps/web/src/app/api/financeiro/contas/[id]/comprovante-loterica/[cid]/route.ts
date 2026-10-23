// GET → abre a foto do comprovante da lotérica ligado a esta conta a pagar
// (endereço assinado de 10 min). Quem vê a conta vê o comprovante dela.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { BUCKET_LOTERICA, filialIdsDoUsuario } from '@/lib/comprovante-loterica';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; cid: string }> }) {
  const auth = await exigirPermApi('conta_pagar.read');
  if (auth.error) return auth.error;
  const { id, cid } = await params;
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(id) || !uuid.test(cid)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });

  const [conta] = await db
    .select({ filialId: schema.contaPagar.filialId })
    .from(schema.contaPagar)
    .where(eq(schema.contaPagar.id, id))
    .limit(1);
  if (!conta) return NextResponse.json({ error: 'conta não encontrada' }, { status: 404 });
  const filiais = await filialIdsDoUsuario(auth.user.id);
  if (!filiais.includes(conta.filialId)) return NextResponse.json({ error: 'sem acesso à casa da conta' }, { status: 403 });

  const [c] = await db
    .select({ storagePath: schema.comprovanteLoterica.storagePath })
    .from(schema.comprovanteLoterica)
    .where(
      and(
        eq(schema.comprovanteLoterica.id, cid),
        isNull(schema.comprovanteLoterica.excluidoEm),
        sql`${schema.comprovanteLoterica.contaPagarIds} @> ${JSON.stringify([id])}::jsonb`,
      ),
    )
    .limit(1);
  if (!c?.storagePath) return NextResponse.json({ error: 'comprovante não encontrado' }, { status: 404 });

  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_LOTERICA).createSignedUrl(c.storagePath, 600);
  if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
