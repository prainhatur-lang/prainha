// POST /api/reservas — cria uma reserva manual no concilia.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CANAIS = new Set(['google', 'instagram', 'site', 'telefone', 'balcao', 'widget', 'outro']);
const STATUS = new Set(['pendente', 'confirmada', 'sentada', 'cancelada', 'no_show', 'concluida']);

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('reserva.create');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  const clienteNome = typeof b?.clienteNome === 'string' ? b.clienteNome.trim() : '';
  const data = typeof b?.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.data) ? b.data : null;
  const hora = typeof b?.hora === 'string' && /^\d{2}:\d{2}$/.test(b.hora) ? b.hora : null;

  if (!filialId || !clienteNome || !data || !hora) {
    return NextResponse.json({ error: 'filial, nome, data e hora são obrigatórios' }, { status: 400 });
  }

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const pessoas = Number.isInteger(b?.pessoas) && b.pessoas > 0 ? Math.min(b.pessoas, 999) : 1;
  const canal = CANAIS.has(b?.canal) ? b.canal : 'outro';
  // Nasce "feita" (pendente) — só vira "confirmada" quando o cliente confirma.
  const status = STATUS.has(b?.status) ? b.status : 'pendente';
  const txt = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  const area = txt(b?.area, 100);

  // Valida hora limite do espaco escolhido (regra: incentivar chegar mais cedo).
  if (area) {
    const [fil] = await db
      .select({ reservaConfig: schema.filial.reservaConfig })
      .from(schema.filial)
      .where(eq(schema.filial.id, filialId))
      .limit(1);
    const espaco = fil?.reservaConfig?.areas?.find((a) => a.nome === area);
    if (espaco?.somenteEventos) {
      return NextResponse.json({ error: `${area} está disponível somente para eventos` }, { status: 400 });
    }
    if (espaco?.horaLimite && hora > espaco.horaLimite) {
      return NextResponse.json(
        { error: `${area} aceita reserva de mesa só até ${espaco.horaLimite}` },
        { status: 400 },
      );
    }
  }

  const [nova] = await db
    .insert(schema.reserva)
    .values({
      filialId,
      clienteNome: clienteNome.slice(0, 200),
      clienteTelefone: txt(b?.clienteTelefone, 30),
      pessoas,
      data,
      hora,
      status,
      area,
      mesa: txt(b?.mesa, 20),
      canal,
      observacao: txt(b?.observacao, 2000),
    })
    .returning({ id: schema.reserva.id });

  return NextResponse.json({ ok: true, id: nova.id });
}
