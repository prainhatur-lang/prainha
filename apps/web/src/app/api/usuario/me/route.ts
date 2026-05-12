// GET /api/usuario/me
// Retorna info basica do usuario logado: id, email, role efetivo.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleEfetivoUsuario } from '@/lib/permissoes';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const role = await roleEfetivoUsuario(user.id);
  return NextResponse.json({
    id: user.id,
    email: user.email,
    role,
  });
}
