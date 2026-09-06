// Tábua de maré simplificada (regra do Elison, 16/08): o AquaArena pode
// PAUSAR na maré baixa dos dias de "maré grande" (segurança das crianças).
// Maré grande = sizígia (lua NOVA ou CHEIA, ±2 dias) — física das marés,
// calculada por fase da lua, sem API externa. A Nina NUNCA afirma que o
// parque estará fechado: só avisa que PODE pausar, e que a equipe no local
// orienta na hora.

const MES_SINODICO = 29.53058867; // dias entre luas novas
const EPOCA_LUA_NOVA_UTC = Date.UTC(2000, 0, 6, 18, 14); // lua nova de referência
const JANELA_SIZIGIA = 2.2; // dias em volta da lua nova/cheia

export interface AvaliacaoMare {
  fase: 'nova' | 'crescente' | 'cheia' | 'minguante';
  mareGrande: boolean;
}

export function avaliarMare(ymd: string): AvaliacaoMare | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  // meio-dia local (~15h UTC) evita ambiguidade de fuso na virada do dia
  const alvo = Date.parse(`${ymd}T15:00:00Z`);
  if (Number.isNaN(alvo)) return null;
  const idade = (((alvo - EPOCA_LUA_NOVA_UTC) / 86400000) % MES_SINODICO + MES_SINODICO) % MES_SINODICO;

  const pertoNova = idade < JANELA_SIZIGIA || idade > MES_SINODICO - JANELA_SIZIGIA;
  const pertoCheia = Math.abs(idade - MES_SINODICO / 2) < JANELA_SIZIGIA;

  const fase: AvaliacaoMare['fase'] = pertoNova
    ? 'nova'
    : pertoCheia
      ? 'cheia'
      : idade < MES_SINODICO / 2
        ? 'crescente'
        : 'minguante';

  return { fase, mareGrande: pertoNova || pertoCheia };
}

// TÁBUA DE MARÉ REAL (pedido do Elison 06/09: "ela pode ler a tábua de
// maré?" — cliente perguntou "que horas o rio está cheio" e a Nina respondeu
// genérico). Fonte: mymento.com.br (republica os dados oficiais da Marinha
// pra Aracaju, ~30 dias à frente). Cache em memória por 12h; falha na busca
// cai no texto de sizígia de sempre.
const TABUA_URL = 'https://mymento.com.br/tabua-de-mares/aracaju-se';
const TABUA_TTL_MS = 12 * 3600 * 1000;
interface Marezinha {
  tipo: 'alta' | 'baixa';
  hora: string;
  altura: number | null;
}
let tabuaCache: { em: number; dias: Map<string, Marezinha[]> } | null = null;

async function tabuaAracaju(): Promise<Map<string, Marezinha[]> | null> {
  if (tabuaCache && Date.now() - tabuaCache.em < TABUA_TTL_MS) return tabuaCache.dias;
  try {
    const r = await fetch(TABUA_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    if (!r.ok) return tabuaCache?.dias ?? null;
    const html = await r.text();
    const dias = new Map<string, Marezinha[]>();
    for (const linha of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
      const celulas = (linha.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? []).map((c) =>
        c.replace(/<[^>]+>/g, '').trim(),
      );
      // Data | Dia da semana | Nº | Tipo | Horário | Altura
      if (celulas.length < 5) continue;
      const md = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(celulas[0]);
      const hora = /^\d{1,2}:\d{2}$/.test(celulas[4]) ? celulas[4] : null;
      if (!md || !hora) continue;
      const ymd = `${md[3]}-${md[2]}-${md[1]}`;
      const tipo = /preamar|alta/i.test(celulas[3]) ? 'alta' as const : 'baixa' as const;
      const altura = celulas[5] ? Number(celulas[5].replace(',', '.')) || null : null;
      if (!dias.has(ymd)) dias.set(ymd, []);
      dias.get(ymd)!.push({ tipo, hora, altura });
    }
    if (dias.size === 0) return tabuaCache?.dias ?? null;
    tabuaCache = { em: Date.now(), dias };
    return dias;
  } catch {
    return tabuaCache?.dias ?? null;
  }
}

/** Texto pro modelo usar na conversa sobre maré/rio/parque numa data. */
export async function consultarMareTexto(ymd: string): Promise<string> {
  const m = avaliarMare(ymd);
  if (!m) return 'Data inválida (use YYYY-MM-DD).';
  const dataBr = ymd.split('-').reverse().join('/');

  const partes: string[] = [];
  const dias = await tabuaAracaju();
  const dia = dias?.get(ymd);
  if (dia && dia.length > 0) {
    const altas = dia.filter((x) => x.tipo === 'alta').map((x) => x.hora);
    const baixas = dia.filter((x) => x.tipo === 'baixa').map((x) => x.hora);
    partes.push(
      `TÁBUA DE MARÉ de ${dataBr} em Aracaju (dados oficiais da Marinha): ` +
        (altas.length ? `maré ALTA (rio cheio) por volta de ${altas.join(' e ')}` : '') +
        (altas.length && baixas.length ? '; ' : '') +
        (baixas.length ? `maré BAIXA (rio mais vazio) por volta de ${baixas.join(' e ')}` : '') +
        '. O rio fica mais cheio nas ~2h em volta de cada maré alta. Pode citar esses horários ao cliente com naturalidade ("o rio deve estar cheio por volta das X").',
    );
  } else {
    partes.push(
      `Sem a tábua exata de ${dataBr} agora (fora da janela de previsão ou fonte indisponível): explique que a maré alta acontece duas vezes por dia e o horário muda ~50 minutos por dia; a equipe no local sabe o horário do dia.`,
    );
  }

  if (m.mareGrande) {
    partes.push(
      `MARÉ GRANDE nesse dia (lua ${m.fase} — sizígia, enche e seca muito). Se falarem do AquaArena: nos horários de maré baixa alguns brinquedos PODEM pausar pela segurança — a equipe orienta na hora; nunca afirme que o parque estará fechado (e lembre: está FECHADO até o verão de toda forma).`,
    );
  }
  return partes.join(' ');
}
