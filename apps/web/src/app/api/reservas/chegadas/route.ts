// GET /api/reservas/chegadas?desde=ISO — usado pela tela /reservas (polling,
// só enquanto a aba está aberta) pra saber se alguma placa bateu com reserva
// nos últimos segundos e avisar a recepção com som. Devolve só reservas com
// placa_chegada_em mais recente que `desde`.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('reserva.read');
  if (error) return error;

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  if (filialIds.length === 0) return NextResponse.json({ chegadas: [], agora: new Date().toISOString() });

  const desdeParam = new URL(request.url).searchParams.get('desde');
  const desde = desdeParam && !Number.isNaN(Date.parse(desdeParam)) ? new Date(desdeParam) : new Date(Date.now() - 60_000);

  const chegadas = await db
    .select({
      id: schema.reserva.id,
      clienteNome: schema.reserva.clienteNome,
      mesa: schema.reserva.mesa,
      area: schema.reserva.area,
      hora: schema.reserva.hora,
      placaVeiculo: schema.reserva.placaVeiculo,
      placaChegadaEm: sql<string>`${schema.reserva.placaChegadaEm}::text`,
    })
    .from(schema.reserva)
    .where(
      and(
        inArray(schema.reserva.filialId, filialIds),
        isNotNull(schema.reserva.placaChegadaEm),
        gt(schema.reserva.placaChegadaEm, desde),
      ),
    );

  return NextResponse.json({ chegadas, agora: new Date().toISOString() });
}
