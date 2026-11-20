// Rede contra REPETIÇÃO da Nina (dono, 20/11/2026: "Nina anda meio perdida,
// repete frases, não está sabendo o que está acontecendo").
//
// As regras contra repetir já estavam no prompt ("DESPEDIDA NÃO É PERGUNTA",
// "não repita a resposta anterior") e o modelo desobedecia: a cada resposta o
// motor reinjeta os mesmos fatos (ocupação ao vivo, feriado, parque fechado) e
// ela devolve os mesmos fatos. Casos das últimas 30 falas:
//   - Vitoria: "Certo" → "A casa está com mesa livre agora, então é só chegar…"
//     (a mesma informação pela 3ª vez)
//   - Cruz: "Joia / Obrigado" → "Hoje, não precisa reservar — a casa abre às 9h…"
//   - João Pedro: "Amanhã é feriado de Consciência Negra e a expectativa é de
//     casa cheia." abrindo 3 mensagens seguidas
//   - Alex: "O parque inflável está fechado até o verão." abrindo 4 mensagens
//
// Aqui só tem função PURA (sem banco, sem modelo): o motor decide com elas o
// que entra no prompt e o que sai pro cliente. Tudo conservador — na dúvida,
// a frase fica.

const EMOJI_RE = /(\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*|[☀-➿])/gu;

/** Tira acento. O `\b` do JS é ASCII: "olá"/"amanhã" não fecham palavra com
 *  acento no fim — por isso toda comparação daqui é feita SEM acento. */
export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Minúsculas, sem acento, sem emoji, sem pontuação, espaço único. */
export function normalizarFrase(s: string): string {
  return semAcento(s.toLowerCase())
    .replace(EMOJI_RE, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cumprimento, agradecimento e "entendi" — o que NÃO pede resposta nova.
// "sim", "pode", "quero", "não" ficam de FORA de propósito: são resposta a uma
// pergunta da Nina, e aí ela precisa agir.
const CORTESIA_EXPRESSOES = [
  'bom dia',
  'boa tarde',
  'boa noite',
  'tudo bem',
  'tudo bom',
  'tudo certo',
  'tudo joia',
  'ta bom',
  'ta certo',
  'ta otimo',
  'ta joia',
  'esta bem',
  'esta bom',
  'esta certo',
  'muito obrigado',
  'muito obrigada',
  'obrigado pela atencao',
  'obrigada pela atencao',
  'obrigado pela informacao',
  'obrigada pela informacao',
  'obrigado pelo retorno',
  'obrigada pelo retorno',
  'de nada',
  'por nada',
  'ate mais',
  'ate logo',
  'ate ja',
  'ate breve',
  'que bom',
  'que otimo',
  'que maravilha',
  'show de bola',
  'deus abencoe',
  'pra voce tambem',
  'para voce tambem',
];
const CORTESIA_PALAVRAS = new Set([
  'oi', 'oie', 'oii', 'ola', 'opa', 'eai', 'hey', 'hello', 'hi',
  'obrigado', 'obrigada', 'obg', 'obgd', 'obgda', 'brigado', 'brigada', 'valeu', 'vlw', 'agradeco', 'agradecido', 'agradecida', 'grato', 'grata',
  'certo', 'certinho', 'joia', 'beleza', 'blz', 'ok', 'okay', 'okk', 'oks', 'show', 'perfeito', 'otimo', 'otima', 'maravilha',
  'entendi', 'entendido', 'combinado', 'legal', 'tranquilo', 'top', 'massa', 'bacana', 'excelente', 'amem',
  'tchau', 'abraco', 'abracos', 'bjs', 'bjo', 'beijo', 'beijos', 'igualmente',
  'ta', 'ah', 'eh', 'viu', 'muito', 'mt', 'mto', 'tb', 'tbm', 'kk', 'kkk', 'kkkk', 'rs', 'rsrs',
  'nina', 'moca', 'querida', 'amiga', 'pessoal', 'gente',
]);

/** A leva do cliente é SÓ cortesia (cumprimento, agradecimento, "entendi",
 *  emoji)? Vazio conta como cortesia (figurinha, reação). Texto comprido não. */
export function soCortesia(textos: string[]): boolean {
  let t = normalizarFrase(textos.join(' '));
  if (!t) return true;
  if (t.length > 60) return false;
  for (const e of CORTESIA_EXPRESSOES) t = t.split(e).join(' ');
  return t
    .split(' ')
    .filter(Boolean)
    .every((p) => CORTESIA_PALAVRAS.has(p));
}

// AVISO DE CHEGADA (dono, 20/11/2026: "observe como ela vem repetindo algumas
// coisas sem nexo"). Relendo as 30 conversas inteiras: o cliente avisava que
// estava vindo e ela devolvia de novo o estado da casa que tinha acabado de dar.
//   - "Ok" / "Estamos a caminho" → "A casa está com mesas livres agora, então é
//     só chegar e procurar a recepção…" (dito 1 minuto antes)
//   - "15 min" / "Obg" / "Bom dia" → "Bom dia! Hoje, a casa está com mesas
//     livres, então é só chegar que a recepção acomoda vocês." (idem)
// Não é cortesia (soCortesia não pega), mas também não pergunta nem pede nada.
// Palavra fora destas listas ("segura a mesa", "tenho reserva", "quantas
// pessoas") = NÃO é só aviso, segue o caminho normal.
const CHEGADA_NUCLEO = new Set([
  'caminho', 'chegando', 'chegandoo', 'indo', 'saindo', 'chego', 'chegamos', 'chegaremos', 'chegarei',
]);
const CHEGADA_MINUTOS = new Set(['min', 'mins', 'minuto', 'minutos', 'minutinho', 'minutinhos']);
const CHEGADA_LIGA = new Set([
  'estou', 'estamos', 'to', 'tou', 'tamo', 'tamos', 'ja', 'a', 'ai', 'la', 'em', 'uns', 'umas', 'daqui', 'pouco',
  'logo', 'agora', 'de', 'casa', 'mais', 'so', 'pra', 'para', 'e', 'eu', 'nos', 'ate', 'no', 'maximo', 'cerca',
]);

/** A leva do cliente é SÓ aviso de que está vindo ("estamos a caminho",
 *  "chegando", "15 min"), com ou sem cortesia junto, e sem pergunta nem pedido?
 *  Conservador: basta uma palavra fora das listas pra dar falso. */
export function soAvisoDeChegada(textos: string[]): boolean {
  if (textos.some((x) => x.includes('?'))) return false;
  let t = normalizarFrase(textos.join(' '));
  if (!t || t.length > 80) return false;
  for (const e of CORTESIA_EXPRESSOES) t = t.split(e).join(' ');
  const palavras = t.split(' ').filter(Boolean);
  let nucleo = false;
  let numero = false;
  let minutos = false;
  for (const p of palavras) {
    if (CHEGADA_NUCLEO.has(p)) nucleo = true;
    else if (CHEGADA_MINUTOS.has(p)) minutos = true;
    else if (/^\d{1,3}$/.test(p)) numero = true;
    else if (/^\d{1,3}(min|mins|minutos)$/.test(p)) {
      numero = true;
      minutos = true;
    } else if (!CHEGADA_LIGA.has(p) && !CORTESIA_PALAVRAS.has(p)) return false;
  }
  // Número solto ("15") ou "minutos" solto não é aviso: precisa do par, ou de
  // um verbo de chegada.
  if (numero !== minutos) return false;
  return nucleo || (numero && minutos);
}

// O que a Nina JÁ disse sobre o movimento da casa. "sem espera"/"sem fila" não
// conta como casa cheia; "esperamos você" também não (só a palavra inteira).
const DISSE_CHEIA_RE = /\bmovimentad|\bcasa cheia\b|\blotad|\bespera\b|\bfila\b/;
// "tranquila"/"calma" só conta quando é da CASA ("a casa está tranquila",
// "hoje está calmo"): "pode ficar tranquila, Zaira" e "venha tranquilo" são
// pra pessoa, não dizem nada do movimento.
const DISSE_LIVRE_RE =
  /\bmesas? (?:livres?|sobrando|disponivel|disponiveis|vagas?)\b|\btem mesa\b|\bcom espaco\b|\b(?:casa|movimento|dia|hoje|agora|aqui)(?: \w+){0,3} (?:tranquil|calm)|\b(?:esta|ta|estamos|segue) (?:\w+ )?(?:tranquil|calm)/;
// "sem fila", "não temos mais fila", "acabou a fila": é o CONTRÁRIO de casa
// cheia (a equipe escreveu "nao temos mais fila" e era lido como fila).
const SEM_FILA_RE =
  /\b(?:sem|nao tem|nao temos|nao ha|nao esta com|nao estamos com|acabou a|acabou)(?: mais)?(?: nenhuma)? (?:fila de espera|lista de espera|fila|espera)\b/;
const SEM_FILA_TODAS_RE = new RegExp(SEM_FILA_RE.source, 'g');
// "a equipe espera vocês", "estamos à espera de vocês": verbo, não fila.
const ESPERA_VERBO_RE = /\b(?:te|os|as|lhe|lhes|nos) espera\b|\bespera (?:por )?(?:voce|voces|todos)\b|\ba espera de (?:voce|voces)\b/g;

/** Olha as falas da Nina, da mais nova pra mais antiga, e devolve o que a
 *  ÚLTIMA que falou do movimento disse: casa com mesa ('livre') ou com
 *  movimento/espera ('cheia'). null = não falou do movimento.
 *  Usado com o aviso de chegada: só vale deixar o estado da casa fora da
 *  resposta se ele JÁ foi dito e continua o mesmo — senão o "estamos a
 *  caminho" é a chance de avisar que a casa encheu. */
export function estadoDaCasaDito(saidas: string[]): 'livre' | 'cheia' | null {
  for (let i = saidas.length - 1; i >= 0; i--) {
    const bruto = normalizarFrase(saidas[i]);
    const disseSemFila = SEM_FILA_RE.test(bruto);
    const t = bruto.replace(SEM_FILA_TODAS_RE, ' ').replace(ESPERA_VERBO_RE, ' ');
    if (DISSE_CHEIA_RE.test(t)) return 'cheia';
    if (disseSemFila || DISSE_LIVRE_RE.test(t)) return 'livre';
  }
  return null;
}

// Palavra que não distingue assunto: se o cliente só falou destas, não "tocou"
// em assunto nenhum (não reabre uma frase já dita).
const GENERICAS = new Set([
  'hoje', 'amanha', 'agora', 'ontem', 'depois', 'antes', 'ainda', 'sobre',
  'reserva', 'reservas', 'reservar', 'mesa', 'mesas', 'casa', 'pessoa', 'pessoas',
  'horario', 'horarios', 'horas', 'quero', 'queria', 'gostaria', 'pode', 'posso', 'poderia', 'podem',
  'tenho', 'temos', 'estou', 'estamos', 'estao', 'esta', 'voces', 'voce', 'vocês',
  'como', 'quando', 'onde', 'qual', 'quais', 'quanto', 'quantos', 'quantas', 'porque',
  'obrigado', 'obrigada', 'muito', 'tambem', 'entao', 'assim', 'isso', 'essa', 'esse', 'aqui', 'para', 'pela', 'pelo',
  'fazer', 'fazendo', 'saber', 'favor', 'seria', 'prainha', 'duvida', 'duvidas', 'ajuda', 'preciso', 'algum', 'alguma',
]);

function radicais(texto: string, minimo: number): Set<string> {
  const out = new Set<string>();
  for (const p of normalizarFrase(texto).split(' ')) {
    if (p.length < minimo || GENERICAS.has(p)) continue;
    out.add(p.slice(0, 5));
  }
  return out;
}

/** Divide em frases GUARDANDO o separador de cada uma (pra remontar igual). */
function dividirFrases(texto: string): Array<{ frase: string; sep: string }> {
  const out: Array<{ frase: string; sep: string }> = [];
  const re = /(?<=[.!?…])\s+|\n+/g;
  let ini = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    out.push({ frase: texto.slice(ini, m.index), sep: m[0] });
    ini = m.index + m[0].length;
  }
  out.push({ frase: texto.slice(ini), sep: '' });
  return out.filter((p) => p.frase.trim() || p.sep);
}

export interface CorteFrases {
  texto: string;
  /** Frases tiradas (pro log). Vazio = nada mudou. */
  cortadas: string[];
}

/**
 * Tira da resposta as FRASES que a Nina já mandou, palavra por palavra, numa
 * das últimas saídas — o preâmbulo que ela repete em toda mensagem ("Amanhã é
 * feriado… casa cheia", "O parque inflável está fechado até o verão").
 *
 * Só corta com tudo isto junto:
 *   - a frase inteira (≥ 25 letras e ≥ 5 palavras) aparece igual numa saída recente;
 *   - não é pergunta nem tem link (pergunta repetida pode ser cobrança legítima);
 *   - o cliente NÃO tocou no assunto dela nesta leva (se perguntou de novo, a
 *     resposta repetida é a resposta certa) nem pediu pra repetir;
 *   - sobra mensagem de verdade depois do corte. Se não sobrar, devolve o
 *     texto original — quem decide o silêncio é o anti-papagaio do motor.
 */
export function tirarFrasesJaDitas(texto: string, saidasRecentes: string[], levaCliente: string[]): CorteFrases {
  const intacto: CorteFrases = { texto, cortadas: [] };
  const leva = levaCliente.join(' ');
  if (/\b(repet|de novo|novamente|nao entendi|como assim|nao vi|nao recebi|pode mandar)/.test(normalizarFrase(leva))) return intacto;
  const anteriores = saidasRecentes.map((s) => ` ${normalizarFrase(s)} `).filter((s) => s.trim());
  if (!anteriores.length) return intacto;
  const assuntoCliente = radicais(leva, 5);

  const partes = dividirFrases(texto);
  const cortadas: string[] = [];
  const ficam = partes.filter(({ frase }) => {
    const f = frase.trim();
    if (!f) return true;
    if (/\?\s*$/.test(f) || /https?:\/\/|www\.|\.com\b/i.test(f)) return true;
    const n = normalizarFrase(f);
    if (n.length < 25 || n.split(' ').length < 5) return true;
    if (!anteriores.some((a) => a.includes(` ${n} `))) return true;
    // O cliente falou do assunto desta frase → ela é resposta, não eco.
    for (const r of radicais(f, 5)) if (assuntoCliente.has(r)) return true;
    cortadas.push(f);
    return false;
  });
  if (!cortadas.length) return intacto;

  let novo = '';
  for (const p of ficam) novo += p.frase + p.sep;
  novo = novo.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // Sobrou só um resto solto ("É só chegar!") → não mexe; o motor decide.
  if (normalizarFrase(novo).length < 12) return intacto;
  // Frase que começava no meio do raciocínio não vira começo de mensagem.
  if (/^(mas|porem|entao|e|por isso|alem disso|tambem)\b/.test(normalizarFrase(novo))) return intacto;
  return { texto: novo, cortadas };
}

const VAZIAS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'e', 'ou', 'que', 'se',
  'com', 'por', 'pra', 'para', 'pro', 'ao', 'aos', 'te', 'me', 'lhe', 'ja', 'so', 'mais', 'mas', 'entao', 'ai', 'la',
  'esta', 'estao', 'estamos', 'esta', 'e', 'foi', 'ser', 'sao', 'tem', 'vai', 'vao', 'voce', 'voces', 'seu', 'sua', 'seus', 'suas',
  'eu', 'nos', 'ele', 'ela', 'isso', 'esse', 'essa', 'este', 'aqui', 'como', 'quando', 'bem', 'muito',
]);

function conteudo(texto: string): Set<string> {
  const out = new Set<string>();
  for (const p of normalizarFrase(texto).split(' ')) {
    if (!p || VAZIAS.has(p)) continue;
    out.add(/^\d/.test(p) ? p : p.slice(0, 5));
  }
  return out;
}

/**
 * Quanto da resposta JÁ FOI DITO nas saídas recentes: fração (0 a 1) das
 * palavras de conteúdo dela que aparecem nas últimas saídas. Número (hora,
 * data, mesa) compara inteiro, sem cortar — "11h30" ≠ "10h30".
 * Resposta curta demais (menos de 4 palavras de conteúdo) devolve 0: "De
 * nada!", "Combinado!" não são paráfrase de nada.
 */
export function quantoJaFoiDito(texto: string, saidasRecentes: string[]): number {
  const novas = conteudo(texto);
  if (novas.size < 4) return 0;
  const ditas = new Set<string>();
  for (const s of saidasRecentes) for (const r of conteudo(s)) ditas.add(r);
  if (!ditas.size) return 0;
  let iguais = 0;
  for (const r of novas) if (ditas.has(r)) iguais++;
  return iguais / novas.size;
}

/** O cliente AFIRMA que já tem reserva ("tenho uma reserva às 11", "deixei uma
 *  reserva", "minha reserva")? Usado pra não tratar como "reserva de boca" a
 *  resposta a quem só avisou de um atraso. */
export function clienteDizQueJaTemReserva(falas: string[]): boolean {
  const t = normalizarFrase(falas.join(' . '));
  return (
    /\b(tenho|temos|tinha|tinhamos|fiz|fizemos|deixei|efetuei|realizei|estou com|estamos com)\b.{0,25}\breserva\b/.test(t) ||
    /\b(minha|nossa) reserva\b/.test(t) ||
    /\b(ja )?reserv(ei|amos)\b/.test(t)
  );
}

/** A leva PEDE uma reserva nova (ou pra mudar)? Aí a rede antiga segue valendo. */
export function clientePedeReservaNova(falas: string[]): boolean {
  const t = normalizarFrase(falas.join(' . '));
  return (
    /\b(fazer|quero|queria|gostaria|poderia|pode|podem|consegue|conseguem|preciso|da pra|tem como)\b.{0,30}\b(reserva|reservar|agendar|marcar)\b/.test(t) ||
    /\b(outra|nova) reserva\b/.test(t)
  );
}
