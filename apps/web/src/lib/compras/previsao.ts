// Previsão de demanda (AVISO, não altera quantidades) pra sugestão de compra.
// Junta previsão do tempo (Open-Meteo, grátis/sem chave) + feriados (BrasilAPI
// nacionais + lista sazonal de Sergipe/Aracaju) e gera avisos qualitativos.
//
// Regra do negócio (Prainha): chuva forte derruba o movimento de bar de praia
// (~-60%); feriado/feriadão e fim de semana de sol puxam pra cima.

// Aracaju-SE (as duas filiais ficam na orla). Ajuste aqui se precisar.
const ARACAJU = { lat: -10.9472, lon: -37.0731 };

export interface AvisoDemanda {
  nivel: 'chuva' | 'sol' | 'feriado';
  data: string; // YYYY-MM-DD
  texto: string;
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function ddmm(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
function diaSemana(iso: string): string {
  const dt = new Date(iso + 'T12:00:00');
  return DIAS_SEMANA[dt.getDay()];
}
function ehFimDeSemana(iso: string): boolean {
  const g = new Date(iso + 'T12:00:00').getDay();
  return g === 0 || g === 6;
}

// Datas sazonais fixas (mês-dia) que mexem com bar de praia em Sergipe.
// Independem de ano. Editável.
const SAZONAIS_SE: Array<{ md: string; nome: string }> = [
  { md: '01-01', nome: 'Réveillon / Ano Novo' },
  { md: '03-17', nome: 'Aniversário de Aracaju' },
  { md: '06-12', nome: 'Véspera de Santo Antônio (São João começa)' },
  { md: '06-13', nome: 'Santo Antônio' },
  { md: '06-23', nome: 'Véspera de São João' },
  { md: '06-24', nome: 'São João (forte no NE)' },
  { md: '06-29', nome: 'São Pedro' },
  { md: '07-08', nome: 'Emancipação Política de Sergipe' },
];

async function getPrevisaoTempo(): Promise<
  Array<{ data: string; chuvaMm: number; chuvaProb: number; tempMax: number }>
> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${ARACAJU.lat}&longitude=${ARACAJU.lon}` +
    `&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max` +
    `&timezone=America%2FSao_Paulo&forecast_days=7`;
  const r = await fetch(url, { next: { revalidate: 3600 } });
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  const j = (await r.json()) as {
    daily?: {
      time?: string[];
      precipitation_sum?: number[];
      precipitation_probability_max?: number[];
      temperature_2m_max?: number[];
    };
  };
  const d = j.daily;
  if (!d?.time) return [];
  return d.time.map((data, i) => ({
    data,
    chuvaMm: d.precipitation_sum?.[i] ?? 0,
    chuvaProb: d.precipitation_probability_max?.[i] ?? 0,
    tempMax: d.temperature_2m_max?.[i] ?? 0,
  }));
}

async function getFeriadosNacionais(ano: number): Promise<Array<{ data: string; nome: string }>> {
  const r = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`, {
    next: { revalidate: 86400 },
  });
  if (!r.ok) throw new Error(`brasilapi ${r.status}`);
  const j = (await r.json()) as Array<{ date: string; name: string }>;
  return j.map((f) => ({ data: f.date, nome: f.name }));
}

/**
 * Gera os avisos de demanda pros próximos 7 dias (clima) e 14 dias (feriados).
 * Tolerante a falha: se uma API cair, retorna o que conseguiu (sem quebrar a página).
 */
export async function avisosDemanda(hojeIso: string): Promise<AvisoDemanda[]> {
  const avisos: AvisoDemanda[] = [];
  const hoje = new Date(hojeIso + 'T12:00:00');
  const limite14 = new Date(hoje.getTime() + 14 * 86400000);

  // Clima (próximos 7 dias)
  try {
    const tempo = await getPrevisaoTempo();
    for (const t of tempo) {
      const forte = t.chuvaProb >= 60 || t.chuvaMm >= 8;
      const fraca = !forte && (t.chuvaProb >= 35 || t.chuvaMm >= 2);
      if (forte) {
        avisos.push({
          nivel: 'chuva',
          data: t.data,
          texto: `🌧️ ${diaSemana(t.data)} ${ddmm(t.data)}: chuva forte (${Math.round(t.chuvaProb)}%, ${t.chuvaMm.toFixed(0)}mm) — movimento costuma cair bastante (~-60%). Cuidado com perecível.`,
        });
      } else if (fraca) {
        avisos.push({
          nivel: 'chuva',
          data: t.data,
          texto: `🌦️ ${diaSemana(t.data)} ${ddmm(t.data)}: pode chover (${Math.round(t.chuvaProb)}%, ${t.chuvaMm.toFixed(0)}mm) — fique de olho.`,
        });
      } else if (ehFimDeSemana(t.data) && t.chuvaProb < 25 && t.tempMax >= 30) {
        avisos.push({
          nivel: 'sol',
          data: t.data,
          texto: `☀️ ${diaSemana(t.data)} ${ddmm(t.data)}: fim de semana de sol (${t.tempMax.toFixed(0)}°C) — movimento pode subir.`,
        });
      }
    }
  } catch {
    // sem clima — segue sem
  }

  // Feriados nacionais (próximos 14 dias)
  try {
    const anos = new Set([hoje.getFullYear(), limite14.getFullYear()]);
    const feriados: Array<{ data: string; nome: string }> = [];
    for (const ano of anos) feriados.push(...(await getFeriadosNacionais(ano)));
    for (const f of feriados) {
      const d = new Date(f.data + 'T12:00:00');
      if (d >= hoje && d <= limite14) {
        avisos.push({
          nivel: 'feriado',
          data: f.data,
          texto: `🎉 ${diaSemana(f.data)} ${ddmm(f.data)}: ${f.nome} (feriado) — movimento pode mudar. Planeje a compra.`,
        });
      }
    }
  } catch {
    // sem feriados nacionais — segue
  }

  // Sazonais de Sergipe (próximos 14 dias) — independem de API
  for (let i = 0; i <= 14; i++) {
    const d = new Date(hoje.getTime() + i * 86400000);
    const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const iso = d.toISOString().slice(0, 10);
    for (const s of SAZONAIS_SE) {
      if (s.md === md) {
        avisos.push({
          nivel: 'feriado',
          data: iso,
          texto: `🎉 ${diaSemana(iso)} ${ddmm(iso)}: ${s.nome} — data forte aqui, costuma puxar o movimento.`,
        });
      }
    }
  }

  // Ordena por data
  return avisos.sort((a, b) => a.data.localeCompare(b.data));
}
