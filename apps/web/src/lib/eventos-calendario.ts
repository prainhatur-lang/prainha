// Calendário de eventos (dono 03/11/2026: "mostrar calendário de eventos com
// status no dashboard e no relatório diário"). Junta numa lista só:
//  - orçamentos de evento (orcamento_evento), com a situação real: entrada
//    paga, aceito sem Pix, enviado, vencido, cancelado (Pix devolvido);
//  - pedidos de evento que a Nina/Otávio anotou e ainda não viraram orçamento
//    (evento_lead com data, status novo/em_contato).
// Recusado e lead perdido ficam de fora — não vão acontecer.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';

export type StatusEventoCal = 'confirmado' | 'aceito' | 'orcamento' | 'vencido' | 'pedido' | 'cancelado';

export const STATUS_EVENTO_CAL: Record<
  StatusEventoCal,
  { label: string; emoji: string; chip: string; ponto: string; ordem: number }
> = {
  confirmado: { label: 'Confirmado (entrada paga)', emoji: '🟢', chip: 'bg-emerald-100 text-emerald-800 border-emerald-200', ponto: 'bg-emerald-500', ordem: 0 },
  aceito: { label: 'Aceito, falta o Pix', emoji: '🟡', chip: 'bg-amber-100 text-amber-800 border-amber-200', ponto: 'bg-amber-500', ordem: 1 },
  orcamento: { label: 'Orçamento enviado', emoji: '🔵', chip: 'bg-sky-100 text-sky-800 border-sky-200', ponto: 'bg-sky-500', ordem: 2 },
  vencido: { label: 'Orçamento vencido', emoji: '🔴', chip: 'bg-rose-100 text-rose-800 border-rose-200', ponto: 'bg-rose-500', ordem: 3 },
  pedido: { label: 'Pedido sem orçamento', emoji: '⚪', chip: 'bg-slate-100 text-slate-700 border-slate-200', ponto: 'bg-slate-400', ordem: 4 },
  cancelado: { label: 'Cancelado (Pix devolvido)', emoji: '⚫', chip: 'bg-slate-50 text-slate-400 border-slate-200 line-through', ponto: 'bg-slate-300', ordem: 5 },
};

export interface EventoCalendario {
  id: string;
  origem: 'orcamento' | 'lead';
  filialId: string;
  data: string; // YYYY-MM-DD
  hora: string | null;
  cliente: string;
  pessoas: number | null;
  local: string | null;
  status: StatusEventoCal;
  numero: number | null;
  entrada: number | null;
  href: string;
}

/** Situação do orçamento a partir dos campos que o fluxo grava. */
export function statusDoOrcamento(
  o: { status: string; pagamentoStatus: string | null; validoAte: string | null; aceiteEm: unknown },
  hoje: string,
): StatusEventoCal | null {
  if (o.pagamentoStatus === 'pago') return 'confirmado';
  if (o.pagamentoStatus === 'reembolsado') return 'cancelado';
  if (o.status === 'recusado') return null;
  if (o.status === 'aceito' || o.aceiteEm) return 'aceito';
  if (o.validoAte && o.validoAte < hoje) return 'vencido';
  return 'orcamento';
}

/** Eventos de [de, ate] (inclusive) das casas pedidas, por data e hora. */
export async function eventosNoPeriodo(filialIds: string[], de: string, ate: string): Promise<EventoCalendario[]> {
  if (!filialIds.length) return [];
  const hoje = hojeBr();
  const ids = sql.join(filialIds.map((id) => sql`${id}::uuid`), sql`, `);

  const orcs = (await db.execute(sql`
    SELECT id, numero, filial_id, data_evento::text AS data, hora, cliente_nome, pessoas, local,
           status, pagamento_status, valido_ate::text AS valido_ate, aceite_em, entrada_valor
      FROM orcamento_evento
     WHERE filial_id IN (${ids})
       AND data_evento BETWEEN ${de}::date AND ${ate}::date
  `)) as unknown as Array<{
    id: string; numero: number; filial_id: string; data: string; hora: string | null; cliente_nome: string;
    pessoas: number; local: string | null; status: string; pagamento_status: string | null;
    valido_ate: string | null; aceite_em: unknown; entrada_valor: string | null;
  }>;

  const leads = (await db.execute(sql`
    SELECT id, filial_id, data_evento::text AS data, hora, nome, telefone, pessoas, espaco, tipo_evento
      FROM evento_lead
     WHERE filial_id IN (${ids})
       AND data_evento BETWEEN ${de}::date AND ${ate}::date
       AND status IN ('novo', 'em_contato')
  `)) as unknown as Array<{
    id: string; filial_id: string; data: string; hora: string | null; nome: string | null; telefone: string | null;
    pessoas: number | null; espaco: string | null; tipo_evento: string | null;
  }>;

  const lista: EventoCalendario[] = [];
  for (const o of orcs) {
    const st = statusDoOrcamento(
      { status: o.status, pagamentoStatus: o.pagamento_status, validoAte: o.valido_ate, aceiteEm: o.aceite_em },
      hoje,
    );
    if (!st) continue;
    lista.push({
      id: o.id,
      origem: 'orcamento',
      filialId: o.filial_id,
      data: o.data,
      hora: o.hora,
      cliente: o.cliente_nome,
      pessoas: o.pessoas,
      local: o.local,
      status: st,
      numero: o.numero,
      entrada: o.entrada_valor != null ? Number(o.entrada_valor) : null,
      href: `/orcamentos/${o.id}`,
    });
  }

  // Lead com o mesmo telefone/nome e data de um orçamento já está coberto por ele.
  const chaveOrc = new Set(orcs.map((o) => `${o.filial_id}|${o.data}|${(o.cliente_nome || '').trim().toLowerCase()}`));
  for (const l of leads) {
    const nome = (l.nome || '').trim();
    if (nome && chaveOrc.has(`${l.filial_id}|${l.data}|${nome.toLowerCase()}`)) continue;
    lista.push({
      id: l.id,
      origem: 'lead',
      filialId: l.filial_id,
      data: l.data,
      hora: l.hora,
      cliente: nome || l.telefone || 'sem nome',
      pessoas: l.pessoas,
      local: l.espaco || l.tipo_evento,
      status: 'pedido',
      numero: null,
      entrada: null,
      href: `/atendimento/eventos?filialId=${l.filial_id}`,
    });
  }

  // Orçamento refeito pro mesmo cliente no mesmo dia (ex.: um pago e outro
  // esperando Pix) aparece uma vez só, com a melhor situação.
  const melhor = new Map<string, EventoCalendario>();
  const unicos: EventoCalendario[] = [];
  for (const e of lista) {
    if (e.origem !== 'orcamento') {
      unicos.push(e);
      continue;
    }
    const k = `${e.filialId}|${e.data}|${e.cliente.trim().toLowerCase()}`;
    const atual = melhor.get(k);
    if (!atual || STATUS_EVENTO_CAL[e.status].ordem < STATUS_EVENTO_CAL[atual.status].ordem) melhor.set(k, e);
  }
  unicos.push(...melhor.values());

  return unicos.sort(
    (a, b) =>
      a.data.localeCompare(b.data) ||
      (a.hora ?? '99').localeCompare(b.hora ?? '99') ||
      STATUS_EVENTO_CAL[a.status].ordem - STATUS_EVENTO_CAL[b.status].ordem,
  );
}

const DIA_SEMANA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "qua 05/11" */
export function rotuloDiaCurto(ymd: string): string {
  const [a, m, d] = ymd.split('-').map(Number);
  const ds = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return `${DIA_SEMANA_CURTO[ds]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/** Uma linha por evento (texto do WhatsApp e lista da tela). */
export function fraseEvento(e: EventoCalendario): string {
  const st = STATUS_EVENTO_CAL[e.status];
  const partes = [
    `${rotuloDiaCurto(e.data)}${e.hora ? ` ${e.hora}` : ''}`,
    e.cliente,
    e.pessoas ? `${e.pessoas} pessoas` : null,
    e.local ? e.local.replace(/\s*\([^)]*\)\s*$/, '') : null,
  ].filter(Boolean);
  return `${st.emoji} ${partes.join(' · ')} — ${st.label.toLowerCase()}`;
}
