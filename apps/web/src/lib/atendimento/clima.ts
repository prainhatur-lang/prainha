// PREVISÃO DO TEMPO pra Nina (pedido do Elison 19/10: cliente perguntou "hoje
// vai chover aí?" e a Nina transferiu pra equipe — a maré ela já sabia).
// Fonte: Open-Meteo (grátis, sem chave), a mesma da sugestão de compra
// (lib/compras/previsao.ts). As três casas ficam em Aracaju, então uma
// coordenada só. Previsão vai até 15 dias; fora disso o texto diz que não tem.

const ARACAJU = { lat: -10.9472, lon: -37.0731 };
const TTL_MS = 30 * 60 * 1000;

interface Previsao {
  diario: Array<{ data: string; chuvaMm: number; chuvaProb: number; tMax: number; tMin: number; codigo: number }>;
  horario: Array<{ hora: string; chuvaProb: number; chuvaMm: number }>;
}
let cache: { em: number; p: Previsao } | null = null;

async function buscarPrevisao(): Promise<Previsao | null> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.p;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${ARACAJU.lat}&longitude=${ARACAJU.lon}` +
      `&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,weather_code` +
      `&hourly=precipitation_probability,precipitation` +
      `&timezone=America%2FSao_Paulo&forecast_days=16`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return cache?.p ?? null;
    const j = (await r.json()) as {
      daily?: {
        time?: string[];
        precipitation_sum?: number[];
        precipitation_probability_max?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        weather_code?: number[];
      };
      hourly?: { time?: string[]; precipitation_probability?: number[]; precipitation?: number[] };
    };
    const d = j.daily;
    if (!d?.time) return cache?.p ?? null;
    const p: Previsao = {
      diario: d.time.map((data, i) => ({
        data,
        chuvaMm: d.precipitation_sum?.[i] ?? 0,
        chuvaProb: d.precipitation_probability_max?.[i] ?? 0,
        tMax: d.temperature_2m_max?.[i] ?? 0,
        tMin: d.temperature_2m_min?.[i] ?? 0,
        codigo: d.weather_code?.[i] ?? 0,
      })),
      horario: (j.hourly?.time ?? []).map((hora, i) => ({
        hora,
        chuvaProb: j.hourly?.precipitation_probability?.[i] ?? 0,
        chuvaMm: j.hourly?.precipitation?.[i] ?? 0,
      })),
    };
    cache = { em: Date.now(), p };
    return p;
  } catch {
    return cache?.p ?? null;
  }
}

// Códigos WMO resumidos.
function ceu(codigo: number): string {
  if (codigo === 0) return 'céu limpo';
  if (codigo <= 2) return 'sol entre nuvens';
  if (codigo === 3) return 'nublado';
  if (codigo <= 48) return 'neblina';
  if (codigo <= 57) return 'garoa';
  if (codigo <= 67) return 'chuva';
  if (codigo <= 77) return 'chuva';
  if (codigo <= 82) return 'pancadas de chuva';
  return 'chuva com trovoada';
}

/** Texto pro modelo responder "vai chover?", "como tá o tempo?" numa data. */
export async function consultarTempoTexto(ymd: string): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return 'Data inválida (use YYYY-MM-DD).';
  const dataBr = ymd.split('-').reverse().join('/');
  const p = await buscarPrevisao();
  const dia = p?.diario.find((x) => x.data === ymd);
  if (!p || !dia) {
    return `Sem previsão do tempo pra ${dataBr} (fora dos próximos 15 dias ou fonte indisponível). Diga com naturalidade que ainda não tem previsão confiável pra essa data — NÃO transfira por isso.`;
  }

  // Faixas do dia com chance de chuva >= 40% (9h–22h, horário de funcionamento).
  const faixas: string[] = [];
  let ini: number | null = null;
  let fim = 0;
  for (const h of p.horario) {
    if (!h.hora.startsWith(ymd)) continue;
    const hh = Number(h.hora.slice(11, 13));
    if (hh < 9 || hh > 22) continue;
    if (h.chuvaProb >= 40) {
      if (ini === null) ini = hh;
      fim = hh;
    } else if (ini !== null) {
      faixas.push(ini === fim ? `por volta das ${ini}h` : `entre ${ini}h e ${fim + 1}h`);
      ini = null;
    }
  }
  if (ini !== null) faixas.push(ini === fim ? `por volta das ${ini}h` : `entre ${ini}h e ${fim + 1}h`);

  const prob = Math.round(dia.chuvaProb);
  const chuva =
    prob >= 60 || dia.chuvaMm >= 8
      ? `chance ALTA de chuva (${prob}%, ~${dia.chuvaMm.toFixed(0)} mm no dia)`
      : prob >= 30 || dia.chuvaMm >= 2
        ? `chance moderada de chuva (${prob}%), provavelmente passageira`
        : `chuva pouco provável (${prob}%)`;

  return (
    `PREVISÃO DO TEMPO de ${dataBr} em Aracaju (Open-Meteo): ${ceu(dia.codigo)}, ` +
    `mínima ${Math.round(dia.tMin)}°C e máxima ${Math.round(dia.tMax)}°C; ${chuva}` +
    (faixas.length ? `; horários com mais chance de chuva: ${faixas.join(', ')}` : '') +
    '. Responda com naturalidade e deixe claro que é PREVISÃO (pode mudar). ' +
    'Se houver chance de chuva, pode lembrar que a casa tem áreas cobertas — só cite áreas que estejam nos blocos de informação.'
  );
}
