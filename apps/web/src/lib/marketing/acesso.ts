// Quem pode montar e publicar post no /marketing: `atendimento.config` + acesso à casa.
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export async function acessoMarketingApi(
  filialId: string | undefined | null,
): Promise<{ user: User; casa: { id: string; nome: string }; error?: undefined } | { error: NextResponse }> {
  const auth = await exigirPermApi('atendimento.config');
  if (auth.error) return { error: auth.error };
  const casas = await filiaisDoUsuario(auth.user.id);
  const casa = casas.find((c) => c.id === filialId);
  if (!casa) return { error: NextResponse.json({ error: 'sem acesso a essa casa' }, { status: 403 }) };
  return { user: auth.user, casa: { id: casa.id, nome: casa.nome } };
}
