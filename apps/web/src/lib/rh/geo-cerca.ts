// Geometria da cerca do ponto pelo celular (24/10/2026). Polígono pequeno
// (uma casa, um estacionamento): projeção plana local em metros basta.

export type Vertice = [number, number]; // [lat, lng]

const M_POR_GRAU_LAT = 110_574;
const M_POR_GRAU_LNG_EQ = 111_320;

function projetar(lat: number, lng: number, lat0: number, lng0: number): [number, number] {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return [(lng - lng0) * M_POR_GRAU_LNG_EQ * k, (lat - lat0) * M_POR_GRAU_LAT];
}

/** Vértices válidos (3+, números finitos) ou null. */
export function verticesValidos(x: unknown): Vertice[] | null {
  if (!Array.isArray(x) || x.length < 3) return null;
  const v: Vertice[] = [];
  for (const p of x) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const la = Number(p[0]);
    const ln = Number(p[1]);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
    v.push([la, ln]);
  }
  return v;
}

/** 0 se o ponto está dentro do polígono; senão a distância em metros até a borda. */
export function distanciaAoPoligonoM(lat: number, lng: number, pontos: Vertice[]): number {
  if (pontos.length < 3) return Infinity;
  const ps = pontos.map(([la, ln]) => projetar(la, ln, lat, lng)); // o ponto vira (0,0)
  let dentro = false;
  let min = Infinity;
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
    const [xi, yi] = ps[i];
    const [xj, yj] = ps[j];
    if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) dentro = !dentro;
    const dx = xj - xi;
    const dy = yj - yi;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(xi * dx + yi * dy) / len2)) : 0;
    const cx = xi + t * dx;
    const cy = yi + t * dy;
    min = Math.min(min, Math.hypot(cx, cy));
  }
  return dentro ? 0 : min;
}

/** Área aproximada em m² (pra mostrar no painel). */
export function areaPoligonoM2(pontos: Vertice[]): number {
  if (pontos.length < 3) return 0;
  const [la0, ln0] = pontos[0];
  const ps = pontos.map(([la, ln]) => projetar(la, ln, la0, ln0));
  let s = 0;
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) s += ps[j][0] * ps[i][1] - ps[i][0] * ps[j][1];
  return Math.abs(s) / 2;
}
