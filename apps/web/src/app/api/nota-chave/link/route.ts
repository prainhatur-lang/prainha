// POST /api/nota-chave/link   Body: { filialId }
// Gera o link assinado do celular (/nota-chave?f&e&s) que lê a chave de
// acesso pela câmera. Só DONO — o mesmo de /api/notas/buscar-xml.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { gerarLinkNotaChave } from '@/lib/nota-chave-link';
import { podeUsuario } from '@/lib/permissoes-runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { filialId } = (await req.json().catch(() => ({}))) as { filialId?: string };
  if (!filialId || !/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId invalido' }, { status: 400 });
  }
  const [link] = await db
    .select({ role: schema.usuarioFilial.role })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  // DONO ou quem dá entrada em nota na casa (nota_compra.create) — o Cauã da
  // Mar não conseguia trazer a nota pela chave (16/10/2026)
  if (!link || (link.role !== 'DONO' && !(await podeUsuario(user.id, 'nota_compra.create')))) {
    return NextResponse.json({ error: 'so DONO pode buscar XML na SEFAZ' }, { status: 403 });
  }

  const l = gerarLinkNotaChave(filialId);
  if (!l) return NextResponse.json({ error: 'PAGAR_MESA_SECRET não configurada' }, { status: 500 });
  // agora = relógio do servidor: o painel pergunta quais notas chegaram desde aqui
  return NextResponse.json({ ok: true, ...l, agora: new Date().toISOString() });
}
