// POST /api/lista-espera — adiciona um grupo na lista de espera da recepcao.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normTelefone(v: string | null): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) d = '55' + d;
  return d;
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('lista_espera.create');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  const nome = typeof b?.nome === 'string' ? b.nome.trim() : '';
  if (!filialId || !nome) {
    return NextResponse.json({ error: 'filial e nome são obrigatórios' }, { status: 400 });
  }

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const pessoas = Number.isInteger(b?.pessoas) && b.pessoas > 0 ? Math.min(b.pessoas, 999) : 1;
  const telefone = normTelefone(typeof b?.telefone === 'string' ? b.telefone : null);
  const txt = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

  const [nova] = await db
    .insert(schema.listaEspera)
    .values({
      filialId,
      nome: nome.slice(0, 200),
      telefone,
      pessoas,
      area: txt(b?.area, 100),
      observacao: txt(b?.observacao, 500),
    })
    .returning({ id: schema.listaEspera.id });

  return NextResponse.json({ ok: true, id: nova.id });
}
