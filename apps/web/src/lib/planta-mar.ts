// Planta física da Prainha Mar (Shopping Praia Sul) — a imagem é o próprio
// "mapa 0410" que o dono mandou em 04/10/2026 (planta do arquiteto com as mesas
// numeradas por ele), recortada no prédio. As posições saem do PDF: centro do
// número de cada mesa, em % da largura/altura da imagem. As redondas (6, 19,
// 20, 54) ficam um pouco à direita do número, em cima da mesa desenhada.
//
// Usada no mapa de Reservas (/reservas → Mapa) e na reserva pública.

export const PLANTA_MAR = {
  src: '/prainhamar/planta-mesas.png?v=2',
  largura: 2400,
  altura: 1256,
  /** Lado da mesa comum e da redonda, em % da largura da planta. */
  ladoPct: 2.5,
  ladoRedondaPct: 3.8,
} as const;

export const PLANTA_MAR_REDONDAS = new Set(['6', '19', '20', '54']);

/** numero da mesa → [x%, y%] do centro na planta. */
export const PLANTA_MAR_MESAS: Record<string, [number, number]> = {
  // salão · banco do fundo
  '1': [13.28, 93.08],
  '2': [15.94, 93.08],
  '3': [19.01, 93.08],
  '4': [22.94, 93.08],
  '5': [26.38, 93.08],
  // salão · entrada
  '6': [14.4, 80.18],
  '7': [20.34, 83.31],
  '8': [24.4, 83.31],
  '9': [28.08, 83.31],
  '10': [16.44, 73.08],
  '11': [21.92, 73.08],
  '12': [25.45, 69.17],
  '13': [29.41, 69.17],
  // salão · banco da janela
  '14': [32.45, 90.36],
  '15': [36.32, 86.09],
  '16': [40.28, 81.72],
  '17': [44.02, 77.57],
  '18': [48.42, 72.72],
  // salão · em frente ao bar
  '19': [34.8, 76.86],
  '20': [41.49, 70.47],
  '21': [46.59, 66.75],
  // salão · corredor (banco)
  '22': [60.62, 57.99],
  '23': [64.3, 53.73],
  '24': [67.55, 48.4],
  '25': [69.91, 45.62],
  '26': [73.25, 41.72],
  '27': [76.28, 37.93],
  // varanda · mureta da calçada (a antiga 50 saiu em 04/10/2026: a 51 virou
  // 50 e assim por diante — a última é a 61)
  '50': [83.41, 30.77],
  '51': [86.01, 27.87],
  '52': [89.78, 23.73],
  '53': [92.97, 19.7],
  '54': [95.45, 12.49],
  // varanda · meio e fundo
  '55': [82.14, 21.78],
  '56': [86.01, 18.11],
  '57': [91.15, 12.6],
  '58': [80.43, 15.21],
  '59': [84.24, 11.12],
  '60': [87.52, 7.16],
  '61': [90.22, 4.14],
};
