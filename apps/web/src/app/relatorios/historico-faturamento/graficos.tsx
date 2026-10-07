// Gráficos da aba Histórico de faturamento (VGV) — SVG desenhado no servidor
// (o app não tem biblioteca de gráfico). Cada ponto leva <title> com o valor
// exato: parar o mouse em cima mostra.

import { MESES_CURTOS, rotuloMes } from '@/lib/faturamento-meses';
import { brl } from '@/lib/format';

// ---------- Formatação (usada também pelo relatório) ----------

/** "+12,3%" / "−7,5%" / "—" */
export function pct(v: number | null, casas = 1): string {
  if (v === null) return '—';
  const n = Math.abs(v) * 100;
  const s = n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const zero = Number(n.toFixed(casas)) === 0;
  return `${zero ? '' : v > 0 ? '+' : '−'}${s}%`;
}

/** Verde sobe, vermelho cai; dentro de ±3% é cinza (estável). */
export function corVar(v: number | null): string {
  if (v === null) return 'text-slate-400';
  if (v >= 0.03) return 'text-emerald-600';
  if (v <= -0.03) return 'text-rose-600';
  return 'text-slate-500';
}

/** "R$ 8,03 mi" / "R$ 547 mil" */
export function compacto(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) {
    return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`;
  }
  if (a >= 1_000) return `R$ ${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return brl(v);
}

/** Sem centavos: "1.364.713" */
export function inteiro(v: number): string {
  return Math.round(v).toLocaleString('pt-BR');
}

// ---------- Escala ----------

const W = 960;
const M = { l: 62, r: 78, t: 26, b: 30 };

/** Teto redondo logo acima do maior valor, e em quantas faixas dividir o eixo. */
export function tetoBonito(max: number): { teto: number; faixas: number } {
  if (!(max > 0)) return { teto: 1, faixas: 4 };
  const mag = 10 ** Math.floor(Math.log10(max));
  const opcoes: Array<[number, number]> = [
    [1, 4], [1.2, 4], [1.5, 3], [2, 4], [2.5, 5], [3, 3], [4, 4], [5, 5], [6, 3], [8, 4], [10, 4],
  ];
  for (const [f, faixas] of opcoes) if (f * mag >= max) return { teto: f * mag, faixas };
  return { teto: 10 * mag, faixas: 4 };
}

function eixo(v: number): string {
  if (v === 0) return '0';
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`;
  if (v >= 1_000) return `${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function caminho(pontos: Array<{ x: number; y: number } | null>): string {
  let d = '';
  let aberto = false;
  for (const p of pontos) {
    if (!p) {
      aberto = false;
      continue;
    }
    d += `${aberto ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    aberto = true;
  }
  return d;
}

function Grade({ teto, faixas, altura }: { teto: number; faixas: number; altura: number }) {
  const linhas = [];
  for (let i = 0; i <= faixas; i++) {
    const v = (teto * i) / faixas;
    const y = M.t + (1 - i / faixas) * (altura - M.t - M.b);
    linhas.push(
      <g key={i}>
        <line x1={M.l} x2={W - M.r} y1={y} y2={y} stroke={i === 0 ? '#94a3b8' : '#e2e8f0'} strokeWidth={1} />
        <text x={M.l - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#64748b">
          {eixo(v)}
        </text>
      </g>,
    );
  }
  return <>{linhas}</>;
}

// ---------- VGV acumulado em 12 meses ----------

export interface Ponto {
  mes: string;
  valor: number;
}

/**
 * Cada ponto = soma dos 12 meses até ali. É a curva que responde "está
 * crescendo?" sem a sazonalidade atrapalhar. `referencia` desenha por baixo a
 * mesma curva sem eventos e festas.
 */
export function Grafico12Meses({ serie, referencia }: { serie: Ponto[]; referencia: Ponto[] | null }) {
  if (serie.length < 2) {
    return (
      <p className="px-4 py-10 text-center text-sm text-slate-500">
        Ainda não há 12 meses fechados seguidos pra desenhar a curva.
      </p>
    );
  }
  const H = 300;
  const { teto, faixas } = tetoBonito(Math.max(...serie.map((p) => p.valor)));
  const x = (i: number) => M.l + (i * (W - M.l - M.r)) / (serie.length - 1);
  const y = (v: number) => M.t + (1 - v / teto) * (H - M.t - M.b);

  const ultimo = serie[serie.length - 1];
  let iPico = 0;
  serie.forEach((p, i) => {
    if (p.valor > serie[iPico].valor) iPico = i;
  });
  const pico = serie[iPico];
  const picoNoFim = iPico === serie.length - 1;
  const ancoraPico = x(iPico) > W - 220 ? 'end' : x(iPico) < M.l + 120 ? 'start' : 'middle';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="VGV acumulado em 12 meses, mês a mês">
      <Grade teto={teto} faixas={faixas} altura={H} />
      {serie.map((p, i) =>
        p.mes.endsWith('-01') ? (
          <g key={p.mes}>
            <line x1={x(i)} x2={x(i)} y1={M.t} y2={H - M.b} stroke="#e2e8f0" strokeDasharray="3 4" />
            <text x={x(i)} y={H - 10} textAnchor="middle" fontSize={11} fill="#64748b">
              {p.mes.slice(0, 4)}
            </text>
          </g>
        ) : null,
      )}
      {referencia && referencia.length === serie.length && (
        <path
          d={caminho(referencia.map((p, i) => ({ x: x(i), y: y(p.valor) })))}
          fill="none"
          stroke="#94a3b8"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      )}
      <path
        d={caminho(serie.map((p, i) => ({ x: x(i), y: y(p.valor) })))}
        fill="none"
        stroke="#0f172a"
        strokeWidth={2.25}
        strokeLinejoin="round"
      />
      {!picoNoFim && (
        <g>
          <circle cx={x(iPico)} cy={y(pico.valor)} r={3.5} fill="#fff" stroke="#0f172a" strokeWidth={1.5} />
          <text x={x(iPico)} y={y(pico.valor) - 9} textAnchor={ancoraPico} fontSize={11} fill="#475569">
            pico {compacto(pico.valor)} · {rotuloMes(pico.mes)}
          </text>
        </g>
      )}
      <circle cx={x(serie.length - 1)} cy={y(ultimo.valor)} r={4} fill="#0f172a" />
      <text x={x(serie.length - 1) + 8} y={y(ultimo.valor) + 4} fontSize={12} fontWeight={600} fill="#0f172a">
        {compacto(ultimo.valor).replace('R$ ', '')}
      </text>
      {serie.map((p, i) => (
        <circle key={p.mes} cx={x(i)} cy={y(p.valor)} r={6} fill="transparent">
          <title>{`12 meses até ${rotuloMes(p.mes)}: ${brl(p.valor)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ---------- Mês a mês, ano contra ano ----------

export interface LinhaAno {
  ano: number;
  cor: string;
  /** 12 posições (jan..dez); null = sem número ou mês que ainda não fechou. */
  valores: Array<number | null>;
  /** Mês em andamento (bolinha vazada, fora da linha). */
  parcial?: { indice: number; valor: number };
}

/** Uma linha por ano sobre os 12 meses: mostra a sazonalidade e onde o ano corrente está. */
export function GraficoMesAMes({ linhas }: { linhas: LinhaAno[] }) {
  const todos = linhas.flatMap((l) => l.valores.filter((v): v is number => v !== null));
  if (todos.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-slate-500">Sem meses fechados pra comparar.</p>;
  }
  const H = 280;
  const { teto, faixas } = tetoBonito(Math.max(...todos));
  const x = (i: number) => M.l + (i * (W - M.l - M.r)) / 11;
  const y = (v: number) => M.t + (1 - v / teto) * (H - M.t - M.b);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Faturamento mês a mês, um ano por linha">
      <Grade teto={teto} faixas={faixas} altura={H} />
      {MESES_CURTOS.map((m, i) => (
        <text key={m} x={x(i)} y={H - 10} textAnchor="middle" fontSize={11} fill="#64748b">
          {m}
        </text>
      ))}
      {linhas.map((l, n) => {
        const atual = n === linhas.length - 1;
        return (
          <g key={l.ano}>
            <path
              d={caminho(l.valores.map((v, i) => (v === null ? null : { x: x(i), y: y(v) })))}
              fill="none"
              stroke={l.cor}
              strokeWidth={atual ? 2.5 : 1.75}
              strokeLinejoin="round"
            />
            {l.valores.map((v, i) =>
              v === null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={atual ? 3.5 : 2.5} fill={l.cor}>
                  <title>{`${MESES_CURTOS[i]}/${l.ano}: ${brl(v)}`}</title>
                </circle>
              ),
            )}
            {l.parcial && (
              <circle
                cx={x(l.parcial.indice)}
                cy={y(Math.min(l.parcial.valor, teto))}
                r={4}
                fill="#fff"
                stroke={l.cor}
                strokeWidth={1.5}
                strokeDasharray="2 2"
              >
                <title>{`${MESES_CURTOS[l.parcial.indice]}/${l.ano} (em andamento): ${brl(l.parcial.valor)}`}</title>
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}
