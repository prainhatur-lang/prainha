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
// Horário de funcionamento (mesmo do prompt da Nina). Fora dele, NUNCA
// convidar a vir "agora" — às 21:57 a Nina chamou cliente pra casa FECHADA
// porque as comandas ainda abertas no PDV davam "casa tranquila" (23/08).
const ABRE = '09:00';
const FECHA = '19:00';

export interface OcupacaoHoje {
  comandasAbertas: number;
  reservasFuturasHoje: number;
  capacidadeMesas: number;
  taxa: number; // 0..1
  /** Corte estendido de hoje ('17:00' | '15:00') ou null = regra padrão.
   *  Já vem VENCIDO como null: se o horário passou, não é mais liberação. */
  corteEstendido: string | null;
  /** Casa com espaço agora (<70%), mesmo que a janela de reserva já tenha
   *  fechado — é o que autoriza o convite "pode vir, tem mesa". */
  casaTranquila: boolean;
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

  // Casa FECHADA agora (fora do 9h–19h): comanda aberta esquecida no PDV não
  // significa casa aberta. Nada de "pode vir agora" — o convite é pra amanhã.
  if (agora >= FECHA || agora < ABRE) {
    return {
      comandasAbertas: 0,
      reservasFuturasHoje: 0,
      capacidadeMesas,
      taxa: 0,
      corteEstendido: null,
      casaTranquila: false,
      resumo: `A casa está FECHADA neste momento (funcionamento: ${ABRE} às ${FECHA}). É PROIBIDO convidar a vir agora ou dizer que "a casa está tranquila" — ela não está recebendo ninguém. Convide pra AMANHÃ (ou o próximo dia aberto) dentro do horário, e ofereça reserva pra essa próxima visita.`,
    };
  }

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

  const casaTranquila = taxa < TAXA_MEDIA;
  const corteBase =
    taxa < TAXA_FRACA ? CORTE_CASA_FRACA : taxa < TAXA_MEDIA ? CORTE_CASA_MEDIA : null;
  // Corte que já passou não libera nada: às 15:25 com corte de 15:00 a Nina
  // chegou a oferecer "dá pra reservar até as 15h" (caso allanis, 16/08).
  const corteEstendido = corteBase && agora < corteBase ? corteBase : null;

  const pct = Math.round(taxa * 100);
  const medida = `${comandasAbertas} comandas abertas + ${reservasFuturasHoje} reservas a chegar, ~${pct}% de ${capacidadeMesas} mesas`;
  const resumo = corteEstendido
    ? `Casa com espaço agora (${medida}) — HOJE a reserva está liberada até ${corteEstendido}.`
    : casaTranquila
      ? `Casa TRANQUILA agora (${medida}), mas a janela de reserva de hoje já fechou. Não dá pra reservar — e ainda assim é boa notícia: tem mesa sobrando. Convide com segurança ("pode vir tranquila, a casa está calma e tem mesa"), nunca com cara de recusa.`
      : `Casa movimentada (${medida}) — hoje vale a regra padrão (tarde por ordem de chegada).`;

  return { comandasAbertas, reservasFuturasHoje, capacidadeMesas, taxa, corteEstendido, casaTranquila, resumo };
}
