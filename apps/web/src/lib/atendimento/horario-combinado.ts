// Conferências feitas em CÓDIGO sobre o histórico da conversa da Nina — regras
// que já estavam escritas no prompt e o modelo deixou passar.
//
// Caso Rafa (Prainha Bar, 05/10/2026):
//  1. a Nina criou a reserva às 09h30 sem ninguém ter falado de horário — ela
//     tinha dito "entre 9h30 e 11h30" e pegou a ponta da faixa; o cliente
//     queria 11h30 e só soube depois de "confirmado";
//  2. o aviso de feriado/casa cheia foi repetido em seis respostas seguidas,
//     porque a consulta de disponibilidade devolve o alerta toda vez.
//
// Funções puras (sem banco, sem rede) pra poderem ser testadas sozinhas.

export interface MsgConversa {
  direcao: string; // entrada | saida
  corpo: string | null;
}

const NUMERO_POR_EXTENSO: Record<string, number> = {
  uma: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
};

/** Minúsculas, sem acento, "meio-dia" e número por extenso viram dígito
 *  (áudio transcrito chega como "onze e meia"). */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bmeio[\s-]?dia\b/g, '12h')
    .replace(/\b(uma|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\b/g, (p) => String(NUMERO_POR_EXTENSO[p]));
}

function minutosDoDia(h: number, m: number): number | null {
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// Um horário escrito com marca de hora: 11:30, 11h30, 11h, 11 horas, 11 e meia.
const HORA_TXT = String.raw`\d{1,2}(?:\s*(?:[:h]|hs|hrs?|horas?)\s*(?:\d{2})?)?(?:\s*e\s*meia)?`;
const FAIXAS = [
  new RegExp(String.raw`entre\s+(?:as\s+)?${HORA_TXT}\s+e\s+(?:as\s+)?${HORA_TXT}`, 'g'),
  new RegExp(String.raw`\bd[aeo]s?\s+${HORA_TXT}\s+(?:ate\s+)?(?:as?\s+)?${HORA_TXT}`, 'g'),
  new RegExp(String.raw`${HORA_TXT}\s*(?:-|–|—|\bas?\b|\bate\b(?:\s+as)?)\s*${HORA_TXT}`, 'g'),
  new RegExp(String.raw`\bate\s+(?:as\s+)?${HORA_TXT}`, 'g'),
  new RegExp(String.raw`\ba partir d[ae]s?\s+${HORA_TXT}`, 'g'),
  new RegExp(String.raw`\b(?:antes|depois|apos)\s+(?:d[ae]s?\s+)?${HORA_TXT}`, 'g'),
];

/** Horários com marca de hora num texto JÁ normalizado, em minutos do dia. */
function horariosMarcados(s: string): Set<number> {
  const out = new Set<number>();
  const add = (h: string, m: string | number) => {
    const v = minutosDoDia(Number(h), Number(m));
    if (v !== null) out.add(v);
  };
  // (?<!\d) e não \b: cliente escreve grudado ("a partir das15h")
  for (const x of s.matchAll(/(?<!\d)(\d{1,2})\s*(?:[:h]|hs|hrs?|horas?)\s*(\d{2})(?!\d)/g)) add(x[1], x[2]);
  for (const x of s.matchAll(/(?<!\d)(\d{1,2})\s*(?:h|hs|hrs?|horas?)\b(?!\s*\d{2}(?!\d))/g)) add(x[1], 0);
  for (const x of s.matchAll(/(?<!\d)(\d{1,2})\s*(?:h|hs|hrs?|horas?)?\s*e\s*meia\b/g)) add(x[1], 30);
  for (const x of s.matchAll(/(?<!\d)(\d{1,2})\s*d[ae]\s*(?:manha|tarde|noite)\b/g)) add(x[1], 0);
  return out;
}

/** Horários que o CLIENTE citou: os marcados + as formas soltas ("às 11",
 *  ou só "11" respondendo a uma pergunta de horário). */
function horariosDoCliente(texto: string, perguntaramHora: boolean): Set<number> {
  const s = normalizar(texto);
  const out = horariosMarcados(s);
  const add = (h: string) => {
    const v = minutosDoDia(Number(h), 0);
    if (v !== null) out.add(v);
  };
  for (const x of s.matchAll(/\b(?:as|pras|pra as|para as|umas|pelas|das)\s+(\d{1,2})\b(?!\s*(?:[:h/]|\d|pessoas|pax|mesas|adultos|criancas|de\b|e\s*meia))/g)) add(x[1]);
  if (perguntaramHora) {
    const solto = /^\W*(?:pode ser|acho que|tipo|umas?|as|pras|la pelas?)?\s*(\d{1,2})\s*(?:mesmo|entao|por favor|pfv?|esta otimo|ta otimo)?\W*$/.exec(s);
    if (solto) add(solto[1]);
  }
  return out;
}

/** Horários que a casa PROPÔS (um por um, não faixa): "posso marcar pras
 *  11h30?" vale; "entre 9h30 e 11h30", "até 11h30" e "a partir das 9h30" não. */
function horariosPropostos(texto: string): Set<number> {
  let s = normalizar(texto);
  for (const re of FAIXAS) s = s.replace(re, ' ~ ');
  return horariosMarcados(s);
}

const PERGUNTA_DE_HORA = /\b(que horas|qual (?:o )?horario|horario (?:voces?|prefere|fica|seria|de chegada)|horas? (?:voces?|pretende|prefere)|chegar)\b/;
const CHEGANDO_AGORA = /\b(agora|ja estamos|estamos chegando|estou chegando|chegando|a caminho|ja ja|(?:ta|to|tou|estou|estamos|estarei|estaremos) indo|indo (?:ai|pra ai|para ai)|daqui a pouco|daqui uns?|daqui \d+)\b/;

/**
 * O horário que o modelo mandou pra criar_reserva foi combinado com o cliente?
 * Vale quando: (a) o cliente citou esse horário; (b) uma das 3 últimas
 * mensagens da casa propôs esse horário (sozinho, não como faixa) e o cliente
 * respondeu depois; (c) reserva de hoje e o cliente disse que vem agora.
 * Bloqueio indevido custa só mais uma pergunta ("posso marcar pras 11h?").
 */
export function horarioFoiCombinado(p: {
  hora: string;
  historico: MsgConversa[];
  /** true quando a reserva é pra hoje (aí "estamos chegando" vale como horário). */
  paraHoje?: boolean;
}): boolean {
  const m = /^(\d{1,2}):(\d{2})/.exec(p.hora.trim());
  if (!m) return true; // hora inválida: quem recusa é a ferramenta de criar
  const alvo = minutosDoDia(Number(m[1]), Number(m[2]));
  if (alvo === null) return true;
  // "3 da tarde" / "às 3" vale pra 15:00
  const serve = (v: number) => v === alvo || (alvo >= 12 * 60 && v === alvo - 12 * 60);

  let ultimaDaCasa = '';
  const daCasa: string[] = [];
  for (const msg of p.historico) {
    const corpo = (msg.corpo ?? '').trim();
    if (!corpo) continue;
    if (msg.direcao === 'entrada') {
      const perguntaram = PERGUNTA_DE_HORA.test(normalizar(ultimaDaCasa));
      for (const v of horariosDoCliente(corpo, perguntaram)) if (serve(v)) return true;
      if (p.paraHoje && CHEGANDO_AGORA.test(normalizar(corpo))) return true;
    } else {
      ultimaDaCasa = corpo;
      daCasa.push(corpo);
    }
  }
  for (const corpo of daCasa.slice(-3)) {
    for (const v of horariosPropostos(corpo)) if (serve(v)) return true;
  }
  return false;
}

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * A casa JÁ deu, nesta conversa, o aviso de dia cheio (feriado / casa cheia /
 * reservar de manhã / tarde por ordem de chegada) pra ESSA data? Só conta a
 * mensagem que cita o dia — aviso dado pra outra data não vale.
 */
export function jaAvisouDiaCheio(historico: MsgConversa[], dataYmd: string): boolean {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataYmd);
  if (!d) return false;
  const dia = Number(d[3]);
  const mes = Number(d[2]);
  const citaODia = new RegExp(
    String.raw`\b(?:0?${dia}\s+de\s+${MESES[mes - 1]}|0?${dia}/0?${mes}(?!\d)|dia\s+0?${dia}(?!\d))`,
  );
  return historico.some((msg) => {
    if (msg.direcao !== 'saida' || !msg.corpo) return false;
    const s = normalizar(msg.corpo);
    return (
      /ordem de chegada/.test(s) &&
      /(feriad|casa cheia|lotar|lota\b|lotad|movimentad|procura)/.test(s) &&
      citaODia.test(s)
    );
  });
}
