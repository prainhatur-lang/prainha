// Armar/desarmar o gatilho de alarme (botão grande do painel de energia).
// Desarmado, o webhook do alarme chega mas é ignorado. Só precisa de
// tuya.control (gerente), não de tuya.configurar.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermApi('tuya.control');
  if (guard.error) return guard.error;
  const { id } = await params;
  const { armado } = (await req.json()) as { armado?: boolean };
  if (typeof armado !== 'boolean') return NextResponse.json({ error: 'armado inválido' }, { status: 400 });

  const [gatilho] = await db
    .select({ filialId: schema.alarmeGatilho.filialId })
    .from(schema.alarmeGatilho)
    .where(eq(schema.alarmeGatilho.id, id));
  if (!gatilho) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(guard.user.id);
  if (!filiais.some((f) => f.id === gatilho.filialId)) {
    return NextResponse.json({ error: 'sem acesso a essa filial' }, { status: 403 });
  }

  const agora = new Date();
  const [atualizado] = await db
    .update(schema.alarmeGatilho)
    .set({
      ativo: armado,
      ativoAlteradoPor: guard.user.email ?? guard.user.id,
      ativoAlteradoEm: agora,
      atualizadoEm: agora,
    })
    .where(eq(schema.alarmeGatilho.id, id))
    .returning();
  return NextResponse.json({
    ok: true,
    armado: atualizado.ativo,
    alteradoPor: atualizado.ativoAlteradoPor,
    alteradoEm: atualizado.ativoAlteradoEm?.toISOString() ?? null,
  });
}
