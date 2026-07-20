// POST /api/reservas — cria uma reserva manual no concilia.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { mesaEstaLivre, mesasEstaoLivres } from '@/lib/reservas/mesa-disponivel';

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
  const mesa = txt(b?.mesa, 20);
  // Segunda mesa juntada lateralmente pra caber grupo maior que 1 mesa só.
  const mesaJuntada = txt(b?.mesaJuntada, 20);

  // Config da filial (mesas do espaço + regras) — busca antes pra poder
  // escopar a checagem de ocupação do Consumer só às mesas desse espaço
  // (ver comentário em mesasOcupadas: sem isso, conta comandas abertas da
  // casa INTEIRA e derruba espaços pequenos como "lotado" à toa).
  let espacoCfg: { somenteEventos?: boolean; horaLimite?: string | null; mesas?: Array<{ numero: string | number }> } | undefined;
  if (area) {
    const [fil] = await db
      .select({ reservaConfig: schema.filial.reservaConfig })
      .from(schema.filial)
      .where(eq(schema.filial.id, filialId))
      .limit(1);
    espacoCfg = fil?.reservaConfig?.areas?.find((a) => a.nome === area);
  }
  const mesasValidas = espacoCfg?.mesas?.map((m) => String(m.numero));

  // Mesa(s) já ocupada(s) por outra reserva ativa no mesmo espaço/data?
  // Bloqueia double-booking.
  if (mesa && area) {
    const livre = mesaJuntada
      ? await mesasEstaoLivres({ filialId, data, area, mesas: [mesa, mesaJuntada], mesasValidas })
      : await mesaEstaLivre({ filialId, data, area, mesa, mesasValidas });
    if (!livre) {
      return NextResponse.json(
        { error: `Mesa ${mesa}${mesaJuntada ? `/${mesaJuntada}` : ''} já está ocupada em ${area} nessa data.` },
        { status: 409 },
      );
    }
  }

  // Valida hora limite do espaco escolhido (regra: incentivar chegar mais cedo).
  if (area) {
    if (espacoCfg?.somenteEventos) {
      return NextResponse.json({ error: `${area} está disponível somente para eventos` }, { status: 400 });
    }
    if (espacoCfg?.horaLimite && hora > espacoCfg.horaLimite) {
      return NextResponse.json(
        { error: `${area} aceita reserva de mesa só até ${espacoCfg.horaLimite}` },
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
      mesa,
      mesaJuntada,
      canal,
      observacao: txt(b?.observacao, 2000),
    })
    .returning({ id: schema.reserva.id });

  return NextResponse.json({ ok: true, id: nova.id });
}
