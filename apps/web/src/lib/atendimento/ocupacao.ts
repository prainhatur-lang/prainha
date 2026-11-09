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
import { hojeBr, horaAgoraBr, diasAtrasBr } from '@/lib/datas';
import { caixaUrlDaFilial } from '@/lib/caixa-loja';
import { pesoNaoConfirmada } from '@/lib/reservas/mesa-disponivel';

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
// Horário de funcionamento DO PRAINHA BAR (mesmo do prompt da Nina). Fora
// dele, NUNCA convidar a vir "agora" — às 21:57 a Nina chamou cliente pra
// casa FECHADA porque as comandas ainda abertas no PDV davam "casa
// tranquila" (23/08). Vale só pras filiais FORA do mapa FUNCIONAMENTO abaixo.
const ABRE = '09:00';
const FECHA = '19:00';

// ─── Funcionamento POR CASA (dono 09/11/2026, caso Valéria no Tabuará) ───
// Domingo às 20:24 o Tabuará estava ABERTO (12h–22h) e o resumo daqui, com o
// 09:00–19:00 do Bar valendo pra toda filial, dizia "A casa está FECHADA" —
// o Otávio respondeu "estamos fechados" e o cliente se perdeu. Cada casa tem
// suas janelas por dia da semana (índice 0 = domingo), com intervalo no meio
// do dia quando houver; fecha '23:59' = "até o último cliente". O Prainha
// Bar (e qualquer filial fora deste mapa) segue nas constantes acima, com o
// comportamento idêntico ao de antes.
interface JanelaDia { abre: string; fecha: string }
const J = (abre: string, fecha: string): JanelaDia => ({ abre, fecha });
// Tabuará (bloco "Sobre o Tabuará" da base da Nina): seg–qui 12h–15h e
// 18h–23h; sexta e sábado das 12h até o último cliente; domingo 12h–22h.
const TABUARA_SEMANA = [J('12:00', '15:00'), J('18:00', '23:00')];
const FUNCIONAMENTO: Record<string, JanelaDia[][]> = {
  // Tabuará
  'fde37b95-7c7e-4b41-a618-2aba1fbc0de7': [
    [J('12:00', '22:00')], // dom
    TABUARA_SEMANA, // seg
    TABUARA_SEMANA, // ter
    TABUARA_SEMANA, // qua
    TABUARA_SEMANA, // qui
    [J('12:00', '23:59')], // sex
    [J('12:00', '23:59')], // sáb
  ],
  // Prainha Mar: abre todos os dias às 12h (bloco da base; o fechamento exato
  // está PENDENTE lá). Fechamento pelo movimento real dos pedidos (15 dias,
  // lido em 09/11/2026): domingo ~21h, seg–qui ~22h, sexta/sábado ~23h.
  'e899dae2-38bf-4f3f-9149-7effd059fab8': [
    [J('12:00', '21:00')], // dom
    [J('12:00', '22:00')], // seg
    [J('12:00', '22:00')], // ter
    [J('12:00', '22:00')], // qua
    [J('12:00', '22:00')], // qui
    [J('12:00', '23:00')], // sex
    [J('12:00', '23:00')], // sáb
  ],
};

function janelasDe(filialId: string, ymd: string): JanelaDia[] | null {
  const f = FUNCIONAMENTO[filialId];
  if (!f) return null;
  const [a, m, d] = ymd.split('-').map(Number);
  return f[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? null;
}

function textoJanelas(janelas: JanelaDia[]): string {
  return janelas
    .map((j) => (j.fecha === '23:59' ? `das ${j.abre} até o último cliente` : `das ${j.abre} às ${j.fecha}`))
    .join(' e ');
}

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
  /** Antes das 9h: a casa abre hoje e vai abrir vazia — reserva pra logo
   *  depois da abertura (9h, 9h30) entra sem a antecedência de 1 h. */
  antesDeAbrir?: boolean;
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

  // Casa com funcionamento próprio (Tabuará, Mar): abre/fecha por dia da
  // semana, com intervalo no meio do dia. Fora dessas, segue o fluxo do Bar
  // logo abaixo, intocado.
  const janelasHoje = janelasDe(filialId, hoje);
  if (janelasHoje) {
    const abertaAgora = janelasHoje.some((j) => agora >= j.abre && agora < j.fecha);
    if (!abertaAgora) {
      const zero = {
        comandasAbertas: 0,
        reservasFuturasHoje: 0,
        capacidadeMesas,
        taxa: 0,
        corteEstendido: null,
        casaTranquila: false,
      };
      const proxima = janelasHoje.find((j) => agora < j.abre);
      if (proxima) {
        // Antes de abrir, ou no intervalo entre o almoço e o jantar.
        return {
          ...zero,
          antesDeAbrir: true,
          resumo: `A casa está FECHADA NESTE INSTANTE mas ABRE HOJE às ${proxima.abre} — o funcionamento de hoje é ${textoJanelas(janelasHoje)}. HOJE É DIA ABERTO: é PROIBIDO dizer que hoje está fechado ou empurrar o cliente pra amanhã. Pedido de reserva pra HOJE vale normalmente dentro desse horário: chame consultar_disponibilidade_reserva / criar_reserva com a data de hoje e deixe a ferramenta decidir horário e área. Só não diga que dá pra vir "agora" — o convite é a partir das ${proxima.abre}.`,
        };
      }
      const janelasAmanha = janelasDe(filialId, diasAtrasBr(-1)) ?? [];
      return {
        ...zero,
        resumo: `A casa está FECHADA neste momento — o funcionamento de hoje era ${textoJanelas(janelasHoje)} e já encerrou. É PROIBIDO convidar a vir agora ou dizer que "a casa está tranquila" — ela não está recebendo ninguém. Convide pra AMANHÃ${janelasAmanha.length > 0 ? ` (amanhã o funcionamento é ${textoJanelas(janelasAmanha)})` : ''} e ofereça reserva pra essa próxima visita.`,
      };
    }
  }

  // AINDA NÃO ABRIU (antes das 9h): a casa abre HOJE. Até 23/10/2026 isso caía
  // no "fechada → convide pra AMANHÃ" abaixo, e às 08:57 de uma sexta a Nina
  // disse ao Charles (5 pessoas, beira do rio, hoje) que "hoje a casa está
  // fechada"; depois se desmentiu e o cliente pediu um humano.
  if (!janelasHoje && agora < ABRE) {
    return {
      comandasAbertas: 0,
      reservasFuturasHoje: 0,
      capacidadeMesas,
      taxa: 0,
      corteEstendido: null,
      casaTranquila: false,
      antesDeAbrir: true,
      resumo: `A casa AINDA NÃO ABRIU — abre HOJE às ${ABRE} (funcionamento: ${ABRE} às ${FECHA}). HOJE É DIA ABERTO: é PROIBIDO dizer que hoje está fechado ou empurrar o cliente pra amanhã. Pedido de reserva pra HOJE vale normalmente: chame consultar_disponibilidade_reserva / criar_reserva com a data de hoje e deixe a ferramenta decidir horário e área. Cliente dizendo "hoje", "já estamos indo", "chegamos logo" = quer chegar assim que abrir: ofereça ${ABRE} ou ${ABRE.replace(':00', ':30')} e feche a reserva (a casa abre vazia, então horário logo depois da abertura está valendo). Só não diga que dá pra vir "agora" — o convite é a partir das ${ABRE}.`,
    };
  }

  // Casa FECHADA agora (depois das 19h): comanda aberta esquecida no PDV não
  // significa casa aberta. Nada de "pode vir agora" — o convite é pra amanhã.
  if (!janelasHoje && agora >= FECHA) {
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
    SELECT count(*)::int AS futuras,
           count(*) FILTER (
             WHERE status = 'pendente' AND confirmada_cliente_em IS NULL
               AND pagamento_status IS NULL
           )::int AS nao_confirmadas
    FROM reserva
    WHERE filial_id = ${filialId}
      AND data = ${hoje}::date
      AND status IN ('pendente', 'confirmada')
      AND hora >= ${agora}
  `)) as unknown as Array<{ futuras: number; nao_confirmadas: number }>;

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
      -- Nome que a própria Nina anota ("cliente a caminho") só pesa por 2 h:
      -- ninguém dá baixa nele, e em 10/10 um nome das 13:22 ainda contava
      -- como fila no fim da tarde. O que a recepção lança vale até dar baixa.
      AND (coalesce(observacao, '') NOT ILIKE 'Entrou pela Nina%' OR criado_em > now() - interval '2 hours')
  `)) as unknown as Array<{ n: number }>;
  const esperaRecepcao = esp?.n ?? 0;
  const reservasFuturasHoje = res?.futuras ?? 0;
  // Reserva a chegar sem confirmação do cliente pesa pelo comparecimento
  // histórico (~30%): dono 08/11/2026, "menos que 50% das pessoas que não
  // confirmaram vêm... reabrir pra não travar a casa".
  const naoConfirmadas = res?.nao_confirmadas ?? 0;
  const pesoNC = naoConfirmadas > 0 ? await pesoNaoConfirmada(filialId) : 1;
  const reservasEsperadas = reservasFuturasHoje - naoConfirmadas + naoConfirmadas * pesoNC;
  const taxa = Math.min((comandasAbertas + reservasEsperadas) / capacidadeMesas, 1);

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
  const medida = `${comandasAbertas} ${fonte === 'loja' ? 'mesas com conta aberta' : 'comandas abertas'} + ${reservasFuturasHoje} reservas a chegar${naoConfirmadas > 0 ? ` (${naoConfirmadas} sem confirmar, contam ${Math.round(pesoNC * 100)}%)` : ""}, ~${pct}% de ${capacidadeMesas} mesas`;
  const resumo = esperaRecepcao > 0
    ? `Tem FILA NA RECEPÇÃO agora: ${esperaRecepcao} grupo(s) esperando mesa (${medida}). Hoje NÃO dá pra reservar e é PROIBIDO dizer que "tem mesa sobrando" ou "pode vir tranquila". A casa segue recebendo por ordem de chegada: seja honesta que tem espera e DIGA quantos grupos estão na fila agora (${esperaRecepcao}); chegando, é só procurar a recepção. Só avise — não ofereça anotar nome em lista nem prometa posição.`
    : corteEstendido
    ? `Casa com espaço agora (${medida}) — HOJE a reserva está liberada só pra horário PRÓXIMO: chegada até ${corteEstendido}. Esse limite acompanha o movimento (quanto mais mesa ocupada, mais curto) — não ofereça horário depois dele; quem quer vir mais tarde vem por ordem de chegada ou chama de novo mais perto da hora.`
    : casaTranquila
      ? `Casa TRANQUILA agora (${medida}), mas a janela de reserva de hoje já fechou. Não dá pra reservar — e ainda assim é boa notícia: tem mesa sobrando. Convide com segurança ("pode vir tranquila, a casa está calma e tem mesa"), nunca com cara de recusa.`
      : `Casa movimentada (${medida}) — hoje vale a regra padrão (tarde por ordem de chegada).`;

  // Casa com funcionamento próprio ABERTA agora (Tabuará, Mar): a régua do
  // corte estendido (15h/17h) e os textos acima são do Bar — lá a janela de
  // reserva fecha cedo e o movimento é que REABRE a tarde. Nessas casas a
  // reserva vai até a noite todo dia, então não existe corte estendido (e
  // dizer "casa tranquila, mas a janela de hoje já fechou" às 14h seria
  // mentira). O resumo aqui informa o que importa: ABERTA agora, com ou sem
  // espaço, e o horário certo da casa.
  let corteFinal = corteEstendido;
  let resumoFinal = resumo;
  if (janelasHoje) {
    corteFinal = null;
    const aberturaTxt = `A casa está ABERTA NESTE MOMENTO (funcionamento de hoje: ${textoJanelas(janelasHoje)}) — é PROIBIDO dizer que está fechada agora.`;
    if (esperaRecepcao > 0) {
      resumoFinal = `${aberturaTxt} ${resumo}`; // o texto da fila já serve
    } else if (casaTranquila) {
      resumoFinal = `${aberturaTxt} Casa com espaço agora (${medida}): pode convidar a vir AGORA com segurança ("pode vir tranquilo, tem mesa"). Reserva pra hoje vale normalmente dentro do horário: chame consultar_disponibilidade_reserva / criar_reserva e responda só com o que elas disserem.`;
    } else {
      resumoFinal = `${aberturaTxt} Casa movimentada agora (${medida}) — pode ter espera na chegada; seja honesta sobre isso. Reserva pra hoje: consulte consultar_disponibilidade_reserva / criar_reserva e responda só com o que elas disserem.`;
    }
  }

  // Dia FECHADO pra reserva pela casa (exceção do calendário): o resumo acima
  // não sabia disso e mandava "reserva liberada até 11h30"; a Nina oferecia, o
  // cliente dizia "pode" e a ferramenta recusava (11/10/2026, caso Valciria —
  // duas respostas opostas em 1 minuto). Com o dia fechado não há reserva
  // liberada: o resumo diz isso e mantém só a parte do movimento.
  if (cfg?.excecoes?.some((e) => e.data === hoje && e.fechado)) {
    const movimento = esperaRecepcao > 0
      ? `Tem fila na recepção agora: ${esperaRecepcao} grupo(s) esperando mesa — avise que tem espera.`
      : casaTranquila
        ? 'A casa está com mesa livre agora — convide a vir direto.'
        : 'A casa está movimentada — pode ter espera.';
    return {
      comandasAbertas, reservasFuturasHoje, capacidadeMesas, taxa, corteEstendido: null, casaTranquila, esperaRecepcao, fonte,
      resumo: `HOJE A CASA FECHOU AS RESERVAS (${medida}): NÃO dá pra reservar pra hoje em área nenhuma e é PROIBIDO oferecer reserva de hoje, "tentar reservar" ou citar horário de chegada liberado. Hoje é por ordem de chegada: chegando, é só procurar a recepção, que acomoda conforme as mesas forem vagando. ${movimento} Reserva que o cliente JÁ TEM pra hoje continua valendo.`,
    };
  }

  return { comandasAbertas, reservasFuturasHoje, capacidadeMesas, taxa, corteEstendido: corteFinal, casaTranquila, esperaRecepcao, fonte, resumo: resumoFinal };
}
