// Quem mexe na Lelis: só o grupo Admin (regra do dono 31/10/2026 — "so tem
// acesso a lelis e eb pessoas autorizadas"). A Lelis fica fora de usuario_filial.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ehAdmin } from '@/lib/usuario-admin';
import { lelisFilialId } from './sincronizar';

export type AcessoLelis =
  | { ok: true; userId: string; email: string; filialId: string }
  | { ok: false; resposta: NextResponse };

export async function acessoLelisApi(): Promise<AcessoLelis> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, resposta: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  if (!(await ehAdmin(user.id))) {
    return { ok: false, resposta: NextResponse.json({ error: 'Só o Admin mexe na Lelis' }, { status: 403 }) };
  }
  const filialId = await lelisFilialId();
  if (!filialId) return { ok: false, resposta: NextResponse.json({ error: 'Lelis não cadastrada' }, { status: 500 }) };
  return { ok: true, userId: user.id, email: user.email ?? user.id, filialId };
}
