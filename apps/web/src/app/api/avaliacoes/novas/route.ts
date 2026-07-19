// GET /api/avaliacoes/novas?desde=ISO — usado pela tela /reservas (polling,
// só enquanto a aba está aberta) pra avisar na hora quando um cliente manda
// uma avaliação nova. Mesmo padrão de /api/reservas/chegadas.
//
// Gateado por 'reserva.read' (não 'avaliacao.read') de propósito: o aviso
// mora na tela de reservas, e Recepção tem reserva.read mas NÃO tem
// avaliacao.read (isso é só Gerente/Admin, pro painel /avaliacoes). Quem
// pode ver /reservas tem que poder ver este aviso.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, gt, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('reserva.read');
  if (error) return error;

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  if (filialIds.length === 0) return NextResponse.json({ novas: [], agora: new Date().toISOString() });

  const desdeParam = new URL(request.url).searchParams.get('desde');
  const desde = desdeParam && !Number.isNaN(Date.parse(desdeParam)) ? new Date(desdeParam) : new Date(Date.now() - 60_000);

  const novas = await db
    .select({
      id: schema.avaliacao.id,
      nota: schema.avaliacao.nota,
      comentario: schema.avaliacao.comentario,
      origem: schema.avaliacao.origem,
    })
    .from(schema.avaliacao)
    .where(and(inArray(schema.avaliacao.filialId, filialIds), gt(schema.avaliacao.criadoEm, desde)));

  return NextResponse.json({ novas, agora: new Date().toISOString() });
}
