import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';

const TIPOS = ['entrada', 'saida', 'luz', 'bomba', 'motor', 'outro'] as const;

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermApi('tuya.configurar');
  if (guard.error) return guard.error;
  const { id } = await params;

  const body = await req.json();
  const { nome, tipo, tuyaDeviceId, codigoSwitch, ativo } = body as {
    nome?: string;
    tipo?: string;
    tuyaDeviceId?: string;
    codigoSwitch?: string;
    ativo?: boolean;
  };
  if (tipo && !TIPOS.includes(tipo as (typeof TIPOS)[number])) {
    return NextResponse.json({ error: `tipo inválido: ${tipo}` }, { status: 400 });
  }

  const [atualizado] = await db
    .update(schema.tuyaDispositivo)
    .set({
      ...(nome !== undefined ? { nome: nome.trim() } : {}),
      ...(tipo !== undefined ? { tipo } : {}),
      ...(tuyaDeviceId !== undefined ? { tuyaDeviceId: tuyaDeviceId.trim() } : {}),
      ...(codigoSwitch !== undefined ? { codigoSwitch: codigoSwitch.trim() || 'switch_1' } : {}),
      ...(ativo !== undefined ? { ativo } : {}),
      atualizadoEm: new Date(),
    })
    .where(eq(schema.tuyaDispositivo.id, id))
    .returning();

  if (!atualizado) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
  return NextResponse.json({ dispositivo: atualizado });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermApi('tuya.configurar');
  if (guard.error) return guard.error;
  const { id } = await params;

  await db.delete(schema.tuyaDispositivo).where(eq(schema.tuyaDispositivo.id, id));
  return NextResponse.json({ ok: true });
}
