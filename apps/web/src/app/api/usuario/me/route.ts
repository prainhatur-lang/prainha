// GET /api/usuario/me
// Retorna info basica do usuario logado: id, email, role efetivo + perms.
// A sidebar (app-sidebar.tsx) usa `perms` pra filtrar os links do menu.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleEfetivoUsuario } from '@/lib/permissoes';
import { permissoesDoUsuario } from '@/lib/permissoes-runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const [role, permsSet] = await Promise.all([
    roleEfetivoUsuario(user.id),
    permissoesDoUsuario(user.id),
  ]);
  return NextResponse.json({
    id: user.id,
    email: user.email,
    role,
    perms: Array.from(permsSet),
  });
}
