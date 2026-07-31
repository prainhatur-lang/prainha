// POST /api/reservas/distribuir-mesas — body { filialId, data }
// Distribui as reservas do dia (sem mesa) nas mesas livres do espaço de cada
// uma, por capacidade (menor mesa que comporta o nº de pessoas). Persiste
// reserva.mesa. Não mexe nas que já têm mesa (deixa o que o staff fixou).

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';

interface MesaCfg { numero: string | number; lugares: number; juntavel?: boolean }
interface AreaCfg { nome: string; mesas?: MesaCfg[] }

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('reserva.update');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const filialId = typeof body?.filialId === 'string' ? body.filialId : '';
  const data = typeof body?.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.data) ? body.data : '';
  if (!filialId || !data) return NextResponse.json({ error: 'filialId e data obrigatórios' }, { status: 400 });

  // Acesso à filial
  const [acesso] = await db
    .select({ id: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const [filial] = await db
    .select({ reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const areas: AreaCfg[] = (filial?.reservaConfig?.areas as AreaCfg[] | undefined) ?? [];
  // mesas por área: { areaNome -> [{numero, lugares}] ordenadas por lugares asc }
  const mesasPorArea = new Map<string, MesaCfg[]>();
  for (const a of areas) {
    const ms = (a.mesas ?? []).slice().sort((x, y) => x.lugares - y.lugares);
    mesasPorArea.set(a.nome, ms);
  }

  const reservas = await db
    .select({
      id: schema.reserva.id,
      nome: schema.reserva.clienteNome,
      pessoas: schema.reserva.pessoas,
      area: schema.reserva.area,
      mesa: schema.reserva.mesa,
    })
    .from(schema.reserva)
    .where(
      and(
        eq(schema.reserva.filialId, filialId),
        eq(schema.reserva.data, data),
        inArray(schema.reserva.status, ['pendente', 'confirmada', 'sentada']),
      ),
    );

  // Mesas já ocupadas por área (reservas que já têm mesa)
  const ocupadasPorArea = new Map<string, Set<string>>();
  for (const r of reservas) {
    if (r.mesa && r.area) {
      if (!ocupadasPorArea.has(r.area)) ocupadasPorArea.set(r.area, new Set());
      ocupadasPorArea.get(r.area)!.add(String(r.mesa));
    }
  }

  // Aloca as sem mesa — maiores grupos primeiro (pra caber nas mesas grandes)
  const semMesa = reservas
    .filter((r) => !r.mesa && r.area)
    .sort((a, b) => (b.pessoas ?? 0) - (a.pessoas ?? 0));

  let alocadas = 0;
  const naoCoube: string[] = [];
  for (const r of semMesa) {
    const mesas = mesasPorArea.get(r.area!) ?? [];
    if (mesas.length === 0) {
      naoCoube.push(`${r.nome} (espaço "${r.area}" sem mesas cadastradas)`);
      continue;
    }
    const ocup = ocupadasPorArea.get(r.area!) ?? new Set<string>();
    // menor mesa livre que comporta o grupo
    const escolha = mesas.find((m) => !ocup.has(String(m.numero)) && m.lugares >= (r.pessoas ?? 1));
    if (!escolha) {
      naoCoube.push(`${r.nome} (${r.pessoas} pessoas — sem mesa livre que comporte)`);
      continue;
    }
    await db.update(schema.reserva).set({ mesa: String(escolha.numero) }).where(eq(schema.reserva.id, r.id));
    ocup.add(String(escolha.numero));
    ocupadasPorArea.set(r.area!, ocup);
    alocadas++;
  }

  return NextResponse.json({ ok: true, alocadas, jaTinhamMesa: reservas.length - semMesa.length, naoCoube });
}
