// Ritmo de pedido por item: de quanto em quanto tempo a cozinha pede cada
// coisa. Regra do dono (20/10/2026): se pediu semana passada e na anterior, o
// estoque do sistema está errado — a frequência do pedido É o consumo. Então a
// sugestão vem do ritmo (semanal / quinzenal / mensal / eventual) e da
// quantidade de costume, não do saldo do estoque.
//
// "Semana com registro" é por grupo (proteínas, mercearia...): semana em que a
// cozinha não mandou lista nem pediu nada daquele grupo pelo sistema (29/09 e
// 06/10 no Bar) não conta como "não pediu" — o pedido foi por fora.

export type Ritmo = 'SEMANAL' | 'QUINZENAL' | 'MENSAL' | 'EVENTUAL';

export interface OcorrenciaCompra {
  /** segunda-feira da semana (YYYY-MM-DD) */
  semana: string;
  produtoId: string;
  quantidade: number;
  unidade: string | null;
  /** L = estava na lista/cotação da cozinha, P = virou pedido de compra */
  fonte: 'L' | 'P';
}

export interface ItemRitmo {
  produtoId: string;
  grupo: string;
  ritmo: Ritmo;
  /** semanas com pedido / semanas com registro do grupo */
  vezes: number;
  semanas: number;
  /** linha do tempo, mais recente primeiro: true = pediu */
  marcas: Array<{ semana: string; pediu: boolean }>;
  /** intervalo típico em semanas com registro (mediana); null = pediu 1 vez */
  intervalo: number | null;
  /** semanas com registro desde a última vez (1 = na última semana com registro) */
  desde: number;
  ultimaSemana: string;
  /** vence nesta semana pelo ritmo */
  vence: boolean;
  quantidade: number;
  unidade: string | null;
}

function mediana(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param ocorrencias tudo que a cozinha pediu (lista) e comprou (pedido), por semana
 * @param grupoDe grupo de cada produto (PROTEINAS, MERCEARIA...)
 * @param semanaRef segunda-feira da semana que está sendo montada — ela e as
 *   seguintes ficam de fora
 * @param janela quantas semanas com registro olhar (por grupo)
 */
export function calcularRitmo(
  ocorrencias: OcorrenciaCompra[],
  grupoDe: (produtoId: string) => string,
  semanaRef: string,
  janela = 6,
): ItemRitmo[] {
  // produto → semana → { lista, pedido }
  const por = new Map<string, Map<string, { L: number; uL: string | null; P: number; uP: string | null }>>();
  const semanasDoGrupo = new Map<string, Set<string>>();
  for (const o of ocorrencias) {
    if (o.semana >= semanaRef) continue;
    const g = grupoDe(o.produtoId);
    if (!semanasDoGrupo.has(g)) semanasDoGrupo.set(g, new Set());
    semanasDoGrupo.get(g)!.add(o.semana);
    if (!por.has(o.produtoId)) por.set(o.produtoId, new Map());
    const m = por.get(o.produtoId)!;
    const a = m.get(o.semana) ?? { L: 0, uL: null, P: 0, uP: null };
    if (o.fonte === 'L') {
      a.L += o.quantidade;
      a.uL ??= o.unidade;
    } else {
      a.P += o.quantidade;
      a.uP ??= o.unidade;
    }
    m.set(o.semana, a);
  }
  const janelaDoGrupo = new Map(
    Array.from(semanasDoGrupo, ([g, s]) => [g, Array.from(s).sort().reverse().slice(0, janela)]),
  );

  const out: ItemRitmo[] = [];
  for (const [pid, m] of por) {
    const grupo = grupoDe(pid);
    const sems = janelaDoGrupo.get(grupo) ?? [];
    const idx = sems.map((s, i) => (m.has(s) ? i : -1)).filter((i) => i >= 0); // 0 = mais recente
    if (!idx.length) continue;
    const vezes = idx.length;
    const n = sems.length;
    const gaps = idx.slice(1).map((v, i) => v - idx[i]);
    const intervalo = gaps.length ? mediana(gaps) : null;
    const desde = idx[0] + 1;

    let ritmo: Ritmo = 'EVENTUAL';
    if (vezes >= 3 && (vezes / n >= 0.6 || (intervalo != null && intervalo <= 1.25))) ritmo = 'SEMANAL';
    else if (vezes >= 2 && intervalo != null && intervalo <= 2.5) ritmo = 'QUINZENAL';
    else if (vezes >= 2 && intervalo != null && intervalo <= 5) ritmo = 'MENSAL';
    // Intervalo 1,5 (alterna 1 e 2 semanas) já vence na semana seguinte.
    const vence = ritmo === 'SEMANAL' || (ritmo !== 'EVENTUAL' && intervalo != null && desde >= intervalo - 0.5);

    // Quantidade de costume: mediana das últimas 4 vezes. A lista é o que a
    // cozinha pediu (o pedido copia a quantidade da lista); sem lista, o pedido.
    const ult = idx.slice(0, 4).map((i) => m.get(sems[i])!);
    const qs = ult.map((a) => (a.L > 0 ? a.L : a.P)).filter((q) => q > 0);
    const unidade = ult.map((a) => (a.L > 0 ? a.uL : a.uP)).find((u) => !!u) ?? null;

    out.push({
      produtoId: pid,
      grupo,
      ritmo,
      vezes,
      semanas: n,
      marcas: sems.map((s) => ({ semana: s, pediu: m.has(s) })),
      intervalo,
      desde,
      ultimaSemana: sems[idx[0]],
      vence,
      quantidade: qs.length ? mediana(qs) : 0,
      unidade,
    });
  }
  const ordem: Record<Ritmo, number> = { SEMANAL: 0, QUINZENAL: 1, MENSAL: 2, EVENTUAL: 3 };
  out.sort((a, b) => Number(b.vence) - Number(a.vence) || ordem[a.ritmo] - ordem[b.ritmo] || b.vezes - a.vezes);
  return out;
}
