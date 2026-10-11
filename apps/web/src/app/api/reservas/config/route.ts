// PUT /api/reservas/config — salva os espaços + hora limite de uma filial.
// Body: { filialId, areas: [{ nome, ativo, somenteEventos?, horaLimite? }] }

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import type { AreaReserva, ReservaConfig } from '@concilia/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { gte } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';
import { mesasDaReserva } from '@/lib/reservas/mesas-juntadas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Lista de mesas de um espaço vinda da tela (⚙️ Espaços → "editar mesas").
// Devolve a lista limpa (sem repetida, em ordem de número) ou null se algum
// item não serve — aí a rota recusa em vez de gravar um cadastro torto.
function limparMesas(v: unknown): AreaReserva['mesas'] | null {
  if (!Array.isArray(v) || v.length > 400) return null;
  const vistas = new Set<string>();
  const out: NonNullable<AreaReserva['mesas']> = [];
  for (const m of v) {
    const numero = String(m?.numero ?? '').trim();
    const lugares = Math.trunc(Number(m?.lugares));
    if (!/^[0-9A-Za-z-]{1,8}$/.test(numero) || numero === '0') return null;
    if (!(lugares >= 1 && lugares <= 40)) return null;
    if (vistas.has(numero)) continue;
    vistas.add(numero);
    out.push({ numero, lugares, ...(m?.juntavel === true ? { juntavel: true } : {}) });
  }
  return out.sort((x, y) => x.numero.localeCompare(y.numero, 'pt-BR', { numeric: true }));
}

export async function PUT(request: Request) {
  const { user, error } = await exigirPermApi('reserva.configurar');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  if (!filialId || !Array.isArray(b?.areas)) {
    return NextResponse.json({ error: 'filialId e areas[] obrigatórios' }, { status: 400 });
  }

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  // Config atual: preserva valores/semOtp/turnos/excecoes e as mesas ja
  // cadastradas por area (a edicao de areas nao mexe nas mesas fisicas).
  const [row] = await db
    .select({ reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const atual: ReservaConfig = row?.reservaConfig ?? { areas: [] };
  const mesasPorArea = new Map<string, AreaReserva['mesas']>();
  for (const a of atual.areas ?? []) if (a?.nome) mesasPorArea.set(a.nome, a.mesas);

  const espacosComMesasEditadas: string[] = [];
  const areas: AreaReserva[] = [];
  for (const a of b.areas) {
    const nome = typeof a?.nome === 'string' ? a.nome.trim().slice(0, 100) : '';
    if (!nome) continue;
    const hl = typeof a?.horaLimite === 'string' && /^\d{2}:\d{2}$/.test(a.horaLimite) ? a.horaLimite : undefined;
    const pct = Number.isFinite(a?.percentualReserva)
      ? Math.max(0, Math.min(100, Math.trunc(a.percentualReserva)))
      : undefined;
    const mesas = mesasPorArea.get(nome);
    const taxaReserva =
      a?.taxaReserva && Number.isFinite(a.taxaReserva.sabDom) && Number.isFinite(a.taxaReserva.diasUteis)
        ? { sabDom: Math.max(0, Number(a.taxaReserva.sabDom)), diasUteis: Math.max(0, Number(a.taxaReserva.diasUteis)) }
        : undefined;
    areas.push({
      nome,
      ativo: a?.ativo !== false,
      ...(a?.somenteEventos ? { somenteEventos: true } : {}),
      ...(hl ? { horaLimite: hl } : {}),
      ...(pct !== undefined ? { percentualReserva: pct } : {}),
      ...(mesas ? { mesas } : {}),
      ...(taxaReserva ? { taxaReserva } : {}),
    });
    // Mesas editadas na tela: só troca quando o espaço veio marcado com
    // `mesasEditadas` — sem a marca vale o que está gravado, como sempre
    // (tela aberta há horas não sobrescreve o cadastro de ninguém).
    if (a?.mesasEditadas === true) {
      const novas = limparMesas(a.mesas);
      if (!novas) {
        return NextResponse.json({ error: `Lista de mesas do espaço "${nome}" inválida (número ou lugares).` }, { status: 400 });
      }
      areas[areas.length - 1].mesas = novas;
      espacosComMesasEditadas.push(nome);
    }
  }

  // Só quando alguma lista de mesas mudou: a mesma mesa não pode ficar em dois
  // espaços (o mapa da loja e a reserva contariam a mesa duas vezes), e reserva
  // futura em mesa que saiu do espaço vira aviso — ela NÃO é cancelada.
  let avisoMesas = '';
  if (espacosComMesasEditadas.length > 0) {
    const dona = new Map<string, string>();
    for (const a of areas) {
      for (const m of a.mesas ?? []) {
        const outra = dona.get(m.numero);
        if (outra && outra !== a.nome) {
          return NextResponse.json({ error: `A mesa ${m.numero} está em dois espaços (${outra} e ${a.nome}). Tire de um deles.` }, { status: 400 });
        }
        dona.set(m.numero, a.nome);
      }
    }
    const presas: string[] = [];
    for (const nome of espacosComMesasEditadas) {
      const antes = (mesasPorArea.get(nome) ?? []).map((m) => String(m.numero));
      const agora = new Set((areas.find((a) => a.nome === nome)?.mesas ?? []).map((m) => m.numero));
      const sairam = new Set(antes.filter((n) => !agora.has(n)));
      if (sairam.size === 0) continue;
      const futuras = await db
        .select({ data: schema.reserva.data, mesa: schema.reserva.mesa, mesaJuntada: schema.reserva.mesaJuntada })
        .from(schema.reserva)
        .where(
          and(
            eq(schema.reserva.filialId, filialId),
            eq(schema.reserva.area, nome),
            gte(schema.reserva.data, hojeBr()),
            inArray(schema.reserva.status, ['pendente', 'confirmada', 'sentada']),
          ),
        );
      for (const r of futuras) {
        for (const n of mesasDaReserva(r.mesa, r.mesaJuntada)) {
          if (sairam.has(n)) presas.push(`${String(r.data).slice(8, 10)}/${String(r.data).slice(5, 7)} mesa ${n} (${nome})`);
        }
      }
    }
    if (presas.length > 0) {
      avisoMesas = `atenção: ${presas.length} reserva(s) em mesa que saiu do espaço — troque a mesa delas: ${presas.slice(0, 12).join(', ')}${presas.length > 12 ? '…' : ''}`;
    }
  }

  const bebidas: string[] | undefined = Array.isArray(b.bebidas)
    ? b.bebidas
        .filter((x: unknown) => typeof x === 'string' && x.trim())
        .map((x: string) => x.trim().slice(0, 60))
        .slice(0, 30)
    : undefined;

  const HORA = /^\d{2}:\d{2}$/;
  const atendimento =
    b.atendimento &&
    HORA.test(b.atendimento.inicio) &&
    HORA.test(b.atendimento.fim) &&
    HORA.test(b.atendimento.fimHojeFimDeSemana)
      ? {
          inicio: b.atendimento.inicio,
          fim: b.atendimento.fim,
          fimHojeFimDeSemana: b.atendimento.fimHojeFimDeSemana,
        }
      : b.atendimento === null
        ? undefined
        : atual.atendimento;

  // Chaves liga/desliga do formulário público. Só entram quando vieram no
  // body — assim salvar só as áreas não apaga o que já estava configurado.
  const flag = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  const pedirCpf = flag(b.pedirCpf);
  const pedirPlaca = flag(b.pedirPlaca);
  const pedirBebida = flag(b.pedirBebida);
  const juntarMesas = flag(b.juntarMesas);

  await db
    .update(schema.filial)
    .set({
      reservaConfig: {
        ...atual,
        areas,
        ...(bebidas !== undefined ? { bebidas } : {}),
        ...(atendimento ? { atendimento } : { atendimento: undefined }),
        ...(pedirCpf !== undefined ? { pedirCpf } : {}),
        ...(pedirPlaca !== undefined ? { pedirPlaca } : {}),
        ...(pedirBebida !== undefined ? { pedirBebida } : {}),
        ...(juntarMesas !== undefined ? { juntarMesas } : {}),
      },
    })
    .where(and(eq(schema.filial.id, filialId), inArray(schema.filial.id, filiais.map((f) => f.id))));

  if (avisoMesas) {
    return NextResponse.json({ ok: true, areas, bebidas, atendimento, pedirCpf, pedirPlaca, pedirBebida, juntarMesas, avisoMesas });
  }
  return NextResponse.json({ ok: true, areas, bebidas, atendimento, pedirCpf, pedirPlaca, pedirBebida, juntarMesas });
}
