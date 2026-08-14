// POST /api/transcrever — { base64, mime? } -> { texto }
// Transcrição de áudio avulso (mesmo whisper da Nina). Uso interno: o dono
// manda áudio com instruções (ex: detalhes de pratos) e o sistema transcreve.
// Auth obrigatório. Limite ~8 MB de áudio.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { transcreverAudio } from '@/lib/atendimento/transcrever';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { base64?: string; mime?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  if (!body.base64) return NextResponse.json({ error: 'base64 obrigatorio' }, { status: 400 });
  if (body.base64.length > 11_000_000) {
    return NextResponse.json({ error: 'audio grande demais (max ~8 MB)' }, { status: 400 });
  }

  const buffer = Buffer.from(body.base64, 'base64');
  const texto = await transcreverAudio(buffer, body.mime ?? 'audio/mpeg');
  if (!texto) {
    return NextResponse.json({ error: 'transcricao falhou ou nao configurada' }, { status: 502 });
  }
  return NextResponse.json({ texto });
}
