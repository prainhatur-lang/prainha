// Ocupação AO VIVO da casa (regra do Elison, 16/08): a Nina acompanha as
// mesas ocupadas e libera reserva de HOJE conforme a procura, pra encher a
// casa — casa vazia abre o corte até mais tarde; casa cheia mantém a regra
// padrão (corte 11:30 fds/feriado → ordem de chegada).
//
// Fonte: comandas ABERTAS do PDV (pedido sem data_fechamento, sincronizado
// pelo agente em ~minutos) + reservas ativas de horário futuro pra hoje.
//
// Régua (ajustável — combinada como padrão inicial):
//   taxa < 40%  -> corte estendido até 17:00 (fim da janela geral)
//   40% a 69%   -> corte estendido até 15:00
//   >= 70%      -> regra padrão (sem extensão)

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import type { ReservaConfig } from '@concilia/db/schema';
import { hojeBr, horaAgoraBr } from '@/lib/datas';

const CORTE_CASA_FRACA = '17:00'; // taxa < 40%
const CORTE_CASA_MEDIA = '15:00'; // taxa 40-69%
const TAXA_FRACA = 0.4;
const TAXA_MEDIA = 0.7;

export interface OcupacaoHoje {
  comandasAbertas: number;
  reservasFuturasHoje: number;
  capacidadeMesas: number;
  taxa: number; // 0..1
  /** Corte estendido de hoje ('17:00' | '15:00') ou null = regra padrão. */
  corteEstendido: string | null;
  resumo: string;
}

export async function medirOcupacaoHoje(
  filialId: string,
  cfg: ReservaConfig | null | undefined,
): Promise<OcupacaoHoje | null> {
  const areas = (cfg?.areas ?? []).filter((a) => a.ativo && !a.somenteEventos);
  const capacidadeMesas = areas.reduce((s, a) => s + (a.mesas?.length ?? 0), 0);
  if (capacidadeMesas === 0) return null;

  const hoje = hojeBr();
  const agora = horaAgoraBr();

  const [pdv] = (await db.execute(sql`
    SELECT count(*)::int AS abertas
    FROM pedido
    WHERE filial_id = ${filialId}
      AND data_delete IS NULL
      AND data_fechamento IS NULL
      AND (data_abertura AT TIME ZONE 'America/Maceio')::date = ${hoje}::date
  `)) as unknown as Array<{ abertas: number }>;

  const [res] = (await db.execute(sql`
    SELECT count(*)::int AS futuras
    FROM reserva
    WHERE filial_id = ${filialId}
      AND data = ${hoje}::date
      AND status IN ('pendente', 'confirmada')
      AND hora >= ${agora}
  `)) as unknown as Array<{ futuras: number }>;

  const comandasAbertas = pdv?.abertas ?? 0;
  const reservasFuturasHoje = res?.futuras ?? 0;
  const taxa = Math.min((comandasAbertas + reservasFuturasHoje) / capacidadeMesas, 1);

  const corteEstendido =
    taxa < TAXA_FRACA ? CORTE_CASA_FRACA : taxa < TAXA_MEDIA ? CORTE_CASA_MEDIA : null;

  const pct = Math.round(taxa * 100);
  const resumo = corteEstendido
    ? `Casa com espaço agora (${comandasAbertas} comandas abertas + ${reservasFuturasHoje} reservas a chegar, ~${pct}% de ${capacidadeMesas} mesas) — HOJE a reserva está liberada até ${corteEstendido}.`
    : `Casa movimentada (${comandasAbertas} comandas abertas + ${reservasFuturasHoje} reservas a chegar, ~${pct}% de ${capacidadeMesas} mesas) — hoje vale a regra padrão (tarde por ordem de chegada).`;

  return { comandasAbertas, reservasFuturasHoje, capacidadeMesas, taxa, corteEstendido, resumo };
}
