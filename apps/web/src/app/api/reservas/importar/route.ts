// POST /api/reservas/importar — importa reservas de fonte externa (ex: Tagme).
// Idempotente: dedupe por (filial_id, origem_externa, id_externo) via upsert.
//
// Body: { filialId, origemExterna: 'tagme', reservas: [{ idExterno, clienteNome,
//   clienteTelefone?, pessoas?, data, hora, status?, area?, mesa?, canal?, observacao? }] }

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { ligacaoDaReserva } from '@/lib/cliente-unico';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CANAIS = new Set(['google', 'instagram', 'site', 'telefone', 'balcao', 'widget', 'outro']);
const STATUS = new Set(['pendente', 'confirmada', 'sentada', 'cancelada', 'no_show', 'concluida']);

// Normaliza status vindo do Tagme (PT) pro nosso enum.
function normStatus(s: unknown): string {
  const t = String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
  if (STATUS.has(t)) return t;
  if (t.startsWith('confirmad')) return 'confirmada';
  if (t.startsWith('sentad')) return 'sentada';
  if (t.startsWith('cancelad')) return 'cancelada';
  if (t.includes('no show') || t.includes('noshow') || t.includes('nao compareceu')) return 'no_show';
  if (t.startsWith('conclu') || t.includes('finalizad')) return 'concluida';
  return 'pendente';
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('reserva.importar');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  const origemExterna = (typeof b?.origemExterna === 'string' ? b.origemExterna : 'tagme').slice(0, 30);
  const reservas = Array.isArray(b?.reservas) ? b.reservas : null;

  if (!filialId || !reservas) {
    return NextResponse.json({ error: 'filialId e reservas[] obrigatórios' }, { status: 400 });
  }
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const txt = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

  let importadas = 0;
  let ignoradas = 0;
  for (const r of reservas) {
    const idExterno = txt(r?.idExterno, 100);
    const clienteNome = txt(r?.clienteNome, 200);
    const data = typeof r?.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.data) ? r.data : null;
    const hora = typeof r?.hora === 'string' && /^\d{1,2}:\d{2}$/.test(r.hora) ? r.hora.padStart(5, '0') : null;
    if (!idExterno || !clienteNome || !data || !hora) {
      ignoradas++;
      continue;
    }
    const canal = CANAIS.has(r?.canal) ? r.canal : 'outro';
    await db
      .insert(schema.reserva)
      .values({
        filialId,
        clienteNome,
        clienteTelefone: txt(r?.clienteTelefone, 30),
        ...(await ligacaoDaReserva(filialId, { telefone: txt(r?.clienteTelefone, 30) })),
        pessoas: Number.isInteger(r?.pessoas) && r.pessoas > 0 ? Math.min(r.pessoas, 999) : 1,
        data,
        hora,
        status: normStatus(r?.status),
        area: txt(r?.area, 100),
        mesa: txt(r?.mesa, 20),
        canal,
        observacao: txt(r?.observacao, 2000),
        origemExterna,
        idExterno,
      })
      .onConflictDoUpdate({
        target: [schema.reserva.filialId, schema.reserva.origemExterna, schema.reserva.idExterno],
        set: {
          clienteNome,
          pessoas: Number.isInteger(r?.pessoas) && r.pessoas > 0 ? Math.min(r.pessoas, 999) : 1,
          data,
          hora,
          status: normStatus(r?.status),
          area: txt(r?.area, 100),
          mesa: txt(r?.mesa, 20),
          canal,
          observacao: txt(r?.observacao, 2000),
          atualizadoEm: new Date(),
        },
      });
    importadas++;
  }

  return NextResponse.json({ ok: true, importadas, ignoradas });
}
