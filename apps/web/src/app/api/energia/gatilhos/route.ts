// Cadastro dos gatilhos de alarme -> Tuya (tela /configuracoes/energia).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { novoTokenGatilho } from '@/lib/alarme-gatilho';

export async function POST(req: Request) {
  const guard = await exigirPermApi('tuya.configurar');
  if (guard.error) return guard.error;

  const { filialId, nome, dispositivoIds, acao, desligarAposMin } = (await req.json()) as {
    filialId?: string;
    nome?: string;
    dispositivoIds?: string[];
    acao?: string;
    desligarAposMin?: number | null;
  };
  if (!filialId || !nome?.trim()) {
    return NextResponse.json({ error: 'filialId e nome são obrigatórios' }, { status: 400 });
  }
  if (acao && acao !== 'ligar' && acao !== 'desligar') {
    return NextResponse.json({ error: 'acao inválida' }, { status: 400 });
  }

  const [criado] = await db
    .insert(schema.alarmeGatilho)
    .values({
      filialId,
      nome: nome.trim(),
      token: novoTokenGatilho(),
      dispositivoIds: dispositivoIds ?? [],
      acao: acao ?? 'ligar',
      desligarAposMin: desligarAposMin && desligarAposMin > 0 ? Math.round(desligarAposMin) : null,
    })
    .returning();
  return NextResponse.json({ gatilho: criado });
}
