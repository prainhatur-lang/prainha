import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { dispararGatilho } from '@/lib/alarme-gatilho';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermApi('tuya.configurar');
  if (guard.error) return guard.error;
  const { id } = await params;

  const { nome, dispositivoIds, acao, desligarAposMin, ativo } = (await req.json()) as {
    nome?: string;
    dispositivoIds?: string[];
    acao?: string;
    desligarAposMin?: number | null;
    ativo?: boolean;
  };
  if (acao !== undefined && acao !== 'ligar' && acao !== 'desligar') {
    return NextResponse.json({ error: 'acao inválida' }, { status: 400 });
  }

  const [atualizado] = await db
    .update(schema.alarmeGatilho)
    .set({
      ...(nome !== undefined ? { nome: nome.trim() } : {}),
      ...(dispositivoIds !== undefined ? { dispositivoIds } : {}),
      ...(acao !== undefined ? { acao } : {}),
      ...(desligarAposMin !== undefined
        ? { desligarAposMin: desligarAposMin && desligarAposMin > 0 ? Math.round(desligarAposMin) : null }
        : {}),
      ...(ativo !== undefined ? { ativo } : {}),
      atualizadoEm: new Date(),
    })
    .where(eq(schema.alarmeGatilho.id, id))
    .returning();
  if (!atualizado) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
  return NextResponse.json({ gatilho: atualizado });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermApi('tuya.configurar');
  if (guard.error) return guard.error;
  const { id } = await params;
  await db.delete(schema.alarmeGatilho).where(eq(schema.alarmeGatilho.id, id));
  return NextResponse.json({ ok: true });
}

/** Botão "Testar" da tela: dispara como se o alarme tivesse chamado. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermApi('tuya.control');
  if (guard.error) return guard.error;
  const { id } = await params;
  const [gatilho] = await db.select().from(schema.alarmeGatilho).where(eq(schema.alarmeGatilho.id, id));
  if (!gatilho) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
  const resultado = await dispararGatilho(gatilho, { teste: true });
  return NextResponse.json({ ok: true, resultado });
}
