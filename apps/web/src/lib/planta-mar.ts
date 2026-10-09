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

/**
 * Desenho limpo da casa — só paredes, bancos e os blocos fixos (bar, cozinha,
 * Espaço Kids…) — no MESMO espaço de coordenadas da planta (2400×1256), pra
 * desenhar em SVG por baixo das mesas. Na reserva pública a imagem da planta
 * ficava ilegível no celular (traço fino, cotas, texto do arquiteto); o SVG
 * fica nítido em qualquer ampliação e pega as cores do tema.
 *
 * De onde sai: `pdftocairo -svg` no "mapa 0410.pdf", só os traços de espessura
 * 9 (paredes), sem as divisórias internas da cozinha/banheiros, levados pro
 * recorte da imagem (x100 y230, 3230 pt de largura → 2400 px). Os blocos e
 * bancos são polígonos marcados à mão em cima desse traçado.
 */
export const PLANTA_MAR_DESENHO = {
  /** paredes (traço grosso da planta do arquiteto) */
  paredes:
    'M69 1235l181 0M263 1235l73 0M361 1235l205 0M580 1235l108 0M721 1230l169-108M915 1107l156-99M1083 1000l135-86M566 1217l14 0M1240 900l185-117M1436 776l147-93M1612 665l118-76M1742 582l137-87M2364 193l15-9M2205 295l14-9M2042 400l14-9M250 1235l0-19M1893 495l9-5M42 1243l672 0l1179-747M721 1230l-10-15l-9 6M55 1141l-13 0M688 1235l14-14M580 1235l0-18M336 1217l25 0M566 1235l0-18M49 1164l7 0M361 1235l0-18M336 1235l0-18M250 1216l13 0l0 19M49 1208l17 0l3 27M38 905l0-25M49 1208l0-44M42 1141l0 102M35 657l0-24M56 1164l-1-23M48 651l0-18M38 905l14-1l0-24l-14 0M35 657l732 0M767 657l0-10M767 640l0-7M48 651l706 0M48 633l-13 0M177 881l15 0l0 23l-15 0l0-23M351 904l13 0l0-23l-13 0l0 23M566 904l13 0l0-23l-13 0l0 23M762 904l13 0l0-23l-13 0l0 23M579 678l0-21M567 682l0-25M1037 652l15 24M754 633l13 0M767 647l154 7l0 3l22 0l0-2l94-3M1086 731l3 5M1068 701l2 4M754 651l0-18M767 640l172 8l102-2M1052 676l37-24M1091 644l58 93M1054 668l32-20M1041 646l13 22M1091 644l96-61M1192 580l110-71M1307 506l72-47M1385 456l71-46M1461 407l71-45M1537 359l317-202M1173 787l43-27M1089 736l37-23M1086 731l37-23M1070 705l37-23M1068 701l36-23M1082 642l4 6M1089 652l15 26M1107 682l16 26M1173 787l3 6M1126 713l20 32M1082 642l640-409M1176 793l321-204M1533 566l98-62M1397 644l73-46M890 1122l-10-15M1221 756l171-109M1216 760l-3-4M1529 561l18-12M1475 595l18-12M1208 899l23-14M1552 546l71-45M1221 756l-3-3M1213 756l5-3M1602 649l10 16M880 1107l25-16l10 16M1071 1008l-10-15l12-8l10 15M1529 561l4 5M1208 899l10 15M1231 885l9 15M1425 783l-10-15l12-7M1427 761l9 15M1582 663l20-14M1582 663l5 9M1493 583l4 6M1537 359l28 43M1568 407l63 97M1601 467l22 34M1532 362l36 54M1572 422l25 39M1596 469l5-2M1593 464l4-3M1593 464l3 5M1721 574l12-7M1832 396l-15-23M1733 567l9 15M1721 574l9 15M1870 481l10-6M1826 399l6-3M1883 480l9-5l10 15M1870 481l9 14M2195 281l10 14M1880 475l13 21M1860 154l300-193M1722 233l598-383M1826 399l-15-23M2033 385l9 15M2210 272l9 14M2047 376l9 15M2354 178l10 15M2369 169l10 15M2033 385l14-9M2195 281l15-9M2354 178l15-9M1583 683l4-11M1811 376l6-3M567 682l12 0l0-25M1828 390l-8-11M1883 189l355-228M1886 194l356-227M1885 205l6-4M1823 394l-12-18l15-10M1883 189l-23-35M1881 197l-27-40M1938 285l5-3M1820 379l10-7M1937 305l15-10M1932 298l10-6M1891 201l-5-7M1885 205l-4-8M1952 295l-9-13M1942 292l-4-7M1826 366l4 6M1933 298l4 7',
  /** contorno do piso da casa */
  piso:
    '42,657 767,657 767,644 1040,649 1056,674 1082,642 1854,157 1884,192 2180,0 2255,0 2372,182 1893,496 714,1240 42,1240',
  /** salão fechado (ainda não inaugurou) */
  fechado: '48,662 570,662 570,890 48,890',
  /** balcão do bar */
  bar: '735,661 1040,653 1066,694 1066,770 735,770',
  /** cozinha e banheiros */
  servico: '1082,642 1537,359 1630,500 1176,793',
  /** Espaço Kids */
  kids: '1537,359 1854,157 1945,298 1630,500',
  /** acesso de serviço */
  escada: '1857,160 2105,0 2180,0 1884,192',
  /** banco das mesas 1 a 5 */
  bancoFundo: '262,1192 712,1192 700,1234 262,1234',
  /** banco das mesas 14 a 18 */
  bancoJanela: '901,1114 1196,927 1183,907 888,1093',
  /** banco das mesas 22 a 27 */
  bancoCorredor: '1241,899 1881,495 1868,475 1228,879',
  /** mureta da varanda (lado da calçada) */
  mureta: 'M1893 496L2372 182L2255 0',
  /** divisórias de vidro */
  vidro:
    'M1630 500L1818 380M1818 379L1945 298L1887 200M42 657L42 890M48 890L570 890M570 662L570 890M735 770L1066 770L1066 694',
} as const;
