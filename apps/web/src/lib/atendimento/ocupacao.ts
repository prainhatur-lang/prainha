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
import { caixaUrlDaFilial } from '@/lib/caixa-loja';

// Reserva liberada pelo movimento é pra HORÁRIO PRÓXIMO (regra do Elison,
// 10/10): quanto mais mesa ocupada, menos pra frente dá pra reservar; com
// gente esperando mesa na recepção não libera nada. Casa vazia = 4 h à
// frente; vai encolhendo em linha reta até zerar nos 70%.
const HORIZONTE_MAX_MIN = 240;
const HORIZONTE_MIN_MIN = 30; // menos que isso não vale liberar

/** Mesas com conta aberta AGORA, lidas direto da loja (vendas-local). A
 *  tabela `pedido` da nuvem só recebe a conta depois de fechada desde que as
 *  casas saíram do Consumer — em 10/10 a loja tinha 32 mesas abertas e a
 *  nuvem contava 0, e a Nina tratava a casa como vazia. null = loja não
 *  respondeu (aí vale a contagem antiga). */
async function mesasAbertasNaLoja(filialId: string, mesasDoMapa: Set<string>): Promise<number | null> {
  try {
    const base = await caixaUrlDaFilial(filialId);
    if (!base) return null;
    const r = await fetch(`${base}/api/venda/abertas`, { signal: AbortSignal.timeout(4000), cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { mesas?: Array<{ numero?: number | string }> };
    if (!Array.isArray(j?.mesas)) return null;
    const abertas = new Set(j.mesas.map((m) => String(m.numero ?? '')).filter((n) => n && n !== '0'));
    // conta só mesa que existe no mapa de reserva (a capacidade é dele)
    let n = 0;
    for (const m of abertas) if (mesasDoMapa.has(m)) n++;
    return n;
  } catch (e) {
    console.warn('[nina] ocupação: loja não respondeu —', e instanceof Error ? e.message : e);
    return null;
  }
}

function somaMinutos(hhmm: string, min: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(h * 60 + m + min, 23 * 60 + 59);
  // arredonda pra baixo na meia hora (os horários de reserva são de 30 em 30)
  const r = t - (t % 30);
  return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
}

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
  /** Grupos esperando mesa na recepção agora (lista de espera de hoje). */
  esperaRecepcao?: number;
  /** De onde veio a contagem de mesas: 'loja' (ao vivo) ou 'nuvem' (antiga). */
  fonte?: 'loja' | 'nuvem';
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

  const mapa = new Set(areas.flatMap((a) => (a.mesas ?? []).map((m) => String(m.numero))));
  const aoVivo = await mesasAbertasNaLoja(filialId, mapa);
  const comandasAbertas = aoVivo ?? pdv?.abertas ?? 0;
  const fonte: 'loja' | 'nuvem' = aoVivo === null ? 'nuvem' : 'loja';

  const [esp] = (await db.execute(sql`
    SELECT count(*)::int AS n
    FROM lista_espera
    WHERE filial_id = ${filialId}
      AND status IN ('aguardando', 'chamado')
      AND (criado_em AT TIME ZONE 'America/Maceio')::date = ${hoje}::date
  `)) as unknown as Array<{ n: number }>;
  const esperaRecepcao = esp?.n ?? 0;
  const reservasFuturasHoje = res?.futuras ?? 0;
  const taxa = Math.min((comandasAbertas + reservasFuturasHoje) / capacidadeMesas, 1);

  // Gente esperando mesa na recepção = casa cheia na prática, mesmo que a
  // conta de mesas diga outra coisa: não libera reserva nem convida "tem mesa".
  const casaTranquila = taxa < TAXA_MEDIA && esperaRecepcao === 0;
  const corteBase =
    esperaRecepcao > 0
      ? null
      : taxa < TAXA_FRACA ? CORTE_CASA_FRACA : taxa < TAXA_MEDIA ? CORTE_CASA_MEDIA : null;
  // Horário próximo, proporcional às mesas ocupadas: o limite é o MENOR entre
  // o corte do dia (17:00/15:00) e agora + horizonte.
  const horizonteMin = Math.round(HORIZONTE_MAX_MIN * Math.max(0, 1 - taxa / TAXA_MEDIA));
  const limiteProximo = horizonteMin >= HORIZONTE_MIN_MIN ? somaMinutos(agora, horizonteMin) : null;
  const corteProporcional =
    corteBase && limiteProximo ? (limiteProximo < corteBase ? limiteProximo : corteBase) : null;
  // Corte que já passou não libera nada: às 15:25 com corte de 15:00 a Nina
  // chegou a oferecer "dá pra reservar até as 15h" (caso allanis, 16/08).
  const corteEstendido = corteProporcional && agora < corteProporcional ? corteProporcional : null;

  const pct = Math.round(taxa * 100);
  const medida = `${comandasAbertas} ${fonte === 'loja' ? 'mesas com conta aberta' : 'comandas abertas'} + ${reservasFuturasHoje} reservas a chegar, ~${pct}% de ${capacidadeMesas} mesas`;
  const resumo = esperaRecepcao > 0
    ? `Tem FILA NA RECEPÇÃO agora: ${esperaRecepcao} grupo(s) esperando mesa (${medida}). Hoje NÃO dá pra reservar e é PROIBIDO dizer que "tem mesa sobrando" ou "pode vir tranquila". A casa segue recebendo por ordem de chegada: seja honesta que tem espera e ofereça colocar o nome na lista de espera.`
    : corteEstendido
    ? `Casa com espaço agora (${medida}) — HOJE a reserva está liberada só pra horário PRÓXIMO: chegada até ${corteEstendido}. Esse limite acompanha o movimento (quanto mais mesa ocupada, mais curto) — não ofereça horário depois dele; quem quer vir mais tarde vem por ordem de chegada ou chama de novo mais perto da hora.`
    : casaTranquila
      ? `Casa TRANQUILA agora (${medida}), mas a janela de reserva de hoje já fechou. Não dá pra reservar — e ainda assim é boa notícia: tem mesa sobrando. Convide com segurança ("pode vir tranquila, a casa está calma e tem mesa"), nunca com cara de recusa.`
      : `Casa movimentada (${medida}) — hoje vale a regra padrão (tarde por ordem de chegada).`;

  return { comandasAbertas, reservasFuturasHoje, capacidadeMesas, taxa, corteEstendido, casaTranquila, esperaRecepcao, fonte, resumo };
}
