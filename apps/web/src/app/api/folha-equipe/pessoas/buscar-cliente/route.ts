import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, ilike, or, asc, isNull } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  const filialId = req.nextUrl.searchParams.get('filialId');
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (!filialId || !q || q.length < 2) {
    return NextResponse.json([]);
  }

  // RBAC
  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  // Busca por nome (ilike) ou CPF
  const cpfDigits = q.replace(/\D/g, '');
  const condicoes = [];
  condicoes.push(ilike(schema.cliente.nome, `%${q}%`));
  if (cpfDigits.length >= 3) {
    condicoes.push(ilike(schema.cliente.cpfOuCnpj, `%${cpfDigits}%`));
  }

  const rows = await db
    .select({
      id: schema.cliente.id,
      nome: schema.cliente.nome,
      cpf: schema.cliente.cpfOuCnpj,
      codigoExterno: schema.cliente.codigoExterno,
    })
    .from(schema.cliente)
    .where(
      and(
        eq(schema.cliente.filialId, filialId),
        isNull(schema.cliente.dataDelete),
        or(...condicoes),
      ),
    )
    .orderBy(asc(schema.cliente.nome))
    .limit(30);

  return NextResponse.json(rows);
}
