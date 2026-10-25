// Selfie do ponto pelo celular (25/10/2026): o gerente vê no /rh/ponto quem
// estava na câmera na hora de bater. ?b=<batida> (modal da batida) ou
// ?t=<tentativa> (lista de tentativas, inclusive as recusadas).
// Só quem lê o ponto e tem acesso à casa da tentativa.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'ponto.read');
  if (semPerm) return semPerm;

  const sp = new URL(req.url).searchParams;
  const b = sp.get('b') ?? '';
  const t = sp.get('t') ?? '';
  if (!UUID.test(b) && !UUID.test(t)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });

  const T = schema.pontoCelularTentativa;
  const [linha] = await db
    .select({ selfie: T.selfie, mime: T.selfieMime, filialId: T.filialId })
    .from(T)
    .where(and(UUID.test(t) ? eq(T.id, t) : eq(T.batidaId, b), isNotNull(T.selfie)))
    .orderBy(desc(T.quando))
    .limit(1);
  if (!linha?.selfie) return new NextResponse('Sem foto pra essa batida (bateu antes de 25/10 ou o celular não mandou).', { status: 404 });

  if (linha.filialId) {
    const [acesso] = await db
      .select({ id: schema.usuarioFilial.filialId })
      .from(schema.usuarioFilial)
      .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, linha.filialId)))
      .limit(1);
    if (!acesso) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
  }

  return new NextResponse(new Uint8Array(linha.selfie), {
    headers: {
      'content-type': linha.mime ?? 'image/jpeg',
      'cache-control': 'private, max-age=3600',
    },
  });
}
