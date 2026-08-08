// GET /api/atendimento/eventos — leads de evento coletados pela Nina.
// Query: ?filial=<id> (opcional).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { desc, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('atendimento.read');
  if (error) return error;

  const url = new URL(request.url);
  const filialParam = url.searchParams.get('filial');
  const filiais = await filiaisDoUsuario(user.id);
  let ids = filiais.map((f) => f.id);
  if (filialParam) {
    if (!ids.includes(filialParam)) {
      return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
    }
    ids = [filialParam];
  }
  if (ids.length === 0) return NextResponse.json({ leads: [] });

  const leads = await db
    .select()
    .from(schema.eventoLead)
    .where(inArray(schema.eventoLead.filialId, ids))
    .orderBy(desc(schema.eventoLead.criadoEm))
    .limit(300);

  const nomes = new Map(filiais.map((f) => [f.id, f.nome]));
  return NextResponse.json({
    leads: leads.map((l) => ({ ...l, filialNome: nomes.get(l.filialId) ?? '' })),
  });
}
