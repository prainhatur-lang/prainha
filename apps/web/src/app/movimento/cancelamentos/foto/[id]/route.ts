// GET /movimento/cancelamentos/foto/[id] — a foto do produto devolvido.
// Mesma permissão da página; só filial que o usuário enxerga.
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('conciliacao.read');
  if (error) return error;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });

  const [row] = await db
    .select({
      filialId: schema.cancelamentoItem.filialId,
      foto: schema.cancelamentoItem.foto,
      mime: schema.cancelamentoItem.fotoMime,
    })
    .from(schema.cancelamentoItem)
    .where(eq(schema.cancelamentoItem.id, id))
    .limit(1);
  if (!row || !row.foto) return NextResponse.json({ error: 'sem foto' }, { status: 404 });

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === row.filialId)) {
    return NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 });
  }
  return new NextResponse(new Uint8Array(row.foto), {
    headers: {
      'content-type': row.mime || 'image/jpeg',
      'cache-control': 'private, max-age=3600',
    },
  });
}
