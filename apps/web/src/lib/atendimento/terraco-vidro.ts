// Conferência feita em CÓDIGO sobre o histórico da conversa da Nina: o cliente
// descreveu o TERRAÇO sem dizer o nome?
//
// Caso Ulisses (Prainha Bar, 06/10/2026): pediu "o restaurante de vidro, o que
// fica na parte superior" pra almoçar no sábado. A Nina respondeu "você está
// falando do Deck Superior" e seguiu pra reserva. O restaurante de vidro é o
// TERRAÇO, que está fechado pro dia a dia (só evento fechado) — o cliente ia
// chegar com mesa no deck aberto achando que era o salão envidraçado. Nada do
// que ela sabia dizia que o Terraço é o de vidro; a regra "a área alta que
// recebe reserva chama Deck Superior" empurrou pro lado errado.
//
// Funções puras (sem banco, sem rede) pra poderem ser testadas sozinhas.

import type { MsgConversa } from './horario-combinado';

/** 'vidro' = descreveu o salão envidraçado (é o Terraço, sem dúvida);
 *  'de_cima' = disse "restaurante de cima/superior" (pode ser o Terraço ou o
 *  Deck Superior — os dois ficam no alto). */
export type TerracoDescrito = 'vidro' | 'de_cima';

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// "vidro", "vidros", "envidraçado", "vidraça"
const VIDRO = /\b(?:vidros?|envidracad[oa]s?|vidracas?)\b/;
// "restaurante superior", "restaurante de cima", "restaurante lá do alto",
// "restaurante que fica em cima / na parte superior"
const RESTAURANTE_DE_CIMA =
  /\brestaurante\b[^.!?\n]{0,40}\b(?:superior|de cima|em cima|la em cima|do alto|no alto|andar de cima|segundo andar|primeiro andar)\b/;
// Copo, garrafa e mesa de vidro não são o salão.
const VIDRO_QUE_NAO_E_SALAO = /\b(?:copos?|garrafas?|tacas?|potes?|cacos?|mesas?)\s+de\s+vidro\b|\bvidro\s+(?:do carro|quebrad)/;

function descricaoNaMensagem(corpo: string): TerracoDescrito | null {
  const s = normalizar(corpo);
  if (/\btabuara\b/.test(s)) return null; // a outra casa não tem Terraço
  if (VIDRO.test(s) && !VIDRO_QUE_NAO_E_SALAO.test(s)) return 'vidro';
  if (RESTAURANTE_DE_CIMA.test(s) && !/\bdeck\b/.test(s)) return 'de_cima';
  return null;
}

/** A casa já disse, depois do pedido, que aquele ambiente é o Terraço? Basta
 *  citar o nome (ou falar do salão de vidro como fechado / só evento). */
function casaJaEsclareceu(corpo: string): boolean {
  const s = normalizar(corpo);
  if (/\bterraco\b/.test(s)) return true;
  return (
    /\b(?:vidros?|envidracad[oa]s?|climatizad[oa]s?)\b/.test(s) &&
    /\b(?:fechad[oa]|eventos?|nao (?:esta )?abr|reabr)/.test(s)
  );
}

/**
 * O cliente descreveu o Terraço ("restaurante de vidro", "restaurante de
 * cima") e a casa AINDA NÃO disse a ele que esse ambiente é o Terraço?
 * Devolve null quando ninguém falou disso ou quando já foi esclarecido — o
 * recado é pra uma vez só, não pra repetir em toda resposta.
 */
export function terracoDescritoSemEsclarecer(historico: MsgConversa[]): TerracoDescrito | null {
  let pendente: TerracoDescrito | null = null;
  for (const msg of historico) {
    const corpo = (msg.corpo ?? '').trim();
    if (!corpo) continue;
    if (msg.direcao === 'entrada') {
      const d = descricaoNaMensagem(corpo);
      // 'vidro' é certeza e não é rebaixado por um "de cima" que venha depois
      if (d === 'vidro' || (d === 'de_cima' && pendente === null)) pendente = d;
    } else if (pendente && casaJaEsclareceu(corpo)) {
      pendente = null;
    }
  }
  return pendente;
}

/** Recado que entra como ÚLTIMA system message enquanto o pedido está sem
 *  esclarecer (posição vence a regra escrita no meio do prompt). */
export function recadoTerraco(tipo: TerracoDescrito): string {
  const oQueDisse =
    tipo === 'vidro'
      ? 'o cliente falou do RESTAURANTE DE VIDRO (o salão fechado com vidro, no alto). Esse ambiente é o TERRAÇO — NÃO é o Deck Superior.'
      : 'o cliente falou do "restaurante de cima/superior". No alto do Prainha Bar existem DOIS ambientes e ele pode estar pensando no TERRAÇO (o restaurante fechado com vidro e climatizado), não no Deck Superior.';
  return `ATENÇÃO — qual ambiente o cliente quer (vale se a conversa é sobre o Prainha Bar): ${oQueDisse}
- TERRAÇO = restaurante fechado com vidro, climatizado, no andar de cima. Está FECHADO pro dia a dia: não recebe reserva de mesa nem almoço/jantar comum, só evento fechado (a previsão de reabertura como restaurante está nos blocos).
- DECK SUPERIOR = deck elevado ABERTO, coberto com telhado, com vista do rio (mesas 101 a 111). É outro ambiente: não é o salão fechado de vidro. É esse que recebe reserva.
O que fazer NESTA resposta, antes de qualquer outra coisa:
- É PROIBIDO dizer "você está falando do Deck Superior" ou tratar os dois como o mesmo lugar. Se você já disse isso nesta conversa, CORRIJA agora com naturalidade ("me confundi: o restaurante de vidro é o Terraço").
- Diga com carinho, em uma ou duas frases, que o restaurante de vidro é o Terraço e que hoje ele só abre pra evento fechado; em seguida ofereça o Deck Superior deixando claro que é OUTRO ambiente (aberto, coberto, com vista do rio) — e pergunte se ele topa.
- NÃO chame criar_reserva antes de o cliente ler isso e aceitar o Deck Superior (ou a Areia). Reserva criada no Deck pra quem pediu o salão de vidro é cliente chegando no lugar errado.
- Se o que ele quer é um EVENTO FECHADO (aniversário, confraternização com menu, casamento), aí sim o Terraço recebe: siga o fluxo de eventos.
- Não é caso de transferir pra equipe: você sabe a resposta.`;
}

/** Resposta da ferramenta quando o modelo tenta criar a reserva sem ter
 *  esclarecido — a criação fica segurada até o cliente saber onde vai sentar. */
export function reservaSeguradaTerraco(tipo: TerracoDescrito): string {
  const fim =
    'NÃO diga que a reserva está feita. Os outros dados você já tem, não peça de novo. Quando ele aceitar o Deck Superior (ou a Areia), chame criar_reserva de novo.';
  if (tipo === 'vidro') {
    return `NÃO CRIEI A RESERVA AINDA — o cliente pediu o RESTAURANTE DE VIDRO, que é o TERRAÇO, e você ainda não disse a ele que o Terraço está fechado pro dia a dia (só recebe evento fechado). Nesta resposta, explique usando o nome "Terraço" que o restaurante de vidro é o Terraço e hoje só abre pra evento, ofereça o Deck Superior deixando claro que é OUTRO ambiente (aberto, coberto, com vista do rio) e pergunte se ele topa. ${fim}`;
  }
  return `NÃO CRIEI A RESERVA AINDA — o cliente pediu o "restaurante de cima/superior" e no alto do Prainha Bar existem dois ambientes: o TERRAÇO (restaurante fechado com vidro, climatizado — hoje só abre pra evento fechado) e o DECK SUPERIOR (deck aberto, coberto, com vista do rio — é o que recebe reserva). Você ainda não esclareceu qual dos dois ele quer. Nesta resposta, diga pelo nome que o Terraço (o de vidro) está fechado pro dia a dia e pergunte se a mesa no Deck Superior atende. ${fim}`;
}
