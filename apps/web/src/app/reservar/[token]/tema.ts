// Tema da reserva pública por filial. A reserva é o primeiro contato do
// cliente com a casa — abrir a reserva da Tabuará no visual do Prainha
// (bege/laranja do pôr do sol) quebra a marca. Cada casa tem o seu.
//
// O visual todo sai destas variáveis CSS: o formulário não tem mais cor
// escrita na mão. Casa nova = mais uma entrada aqui.

export interface TemaReserva {
  /** Fonte de título: 'serif-classica' (Prainha) ou 'serif-alta' (Tabuará). */
  fonte: 'dm' | 'playfair';
  /** Marca no topo (o ponto sai na cor de destaque). */
  marca: string;
  /** Chamada e apoio do painel esquerdo (só no computador). */
  titulo: string;
  subtitulo: string;
  bullets: string[];
  /** Linha embaixo do "Reserve sua mesa", dentro do cartão. */
  convite: string;
  /** Emoji da tela de sucesso e dos avisos de horário. */
  emoji: string;
  vars: Record<string, string>;
}

const PRAINHA: TemaReserva = {
  fonte: 'dm',
  marca: 'Prainha',
  titulo: 'Sua mesa com o melhor pôr do sol de Sergipe.',
  subtitulo:
    'À beira do rio Vaza Barris, em Matapoã. Reserve em 1 minuto e a gente garante seu lugar pra hora dourada.',
  bullets: ['🌅 Vista do pôr do sol', '🍤 Frutos do mar fresquinhos', '📍 À beira do rio, em Matapoã'],
  convite: 'venha curtir o pôr do sol 🌅',
  emoji: '🌅',
  vars: {
    '--rsv-bg':
      'linear-gradient(180deg,#07191c 0%,#143a3d 26%,#5a6a4f 46%,#c98a3f 66%,#e7873a 82%,#b3411c 100%)',
    '--rsv-glow':
      'radial-gradient(circle, rgba(255,236,184,0.55) 0%, rgba(231,135,58,0.18) 38%, transparent 64%)',
    '--rsv-vignette':
      'radial-gradient(120% 90% at 50% 30%, transparent 45%, rgba(7,25,28,0.45) 100%)',
    '--rsv-brand': '#fbf6ec',
    '--rsv-brand-dot': '#f4b454',
    '--rsv-on-bg': '#fbf6ec',
    '--rsv-card-bg': '#fbf6ec',
    '--rsv-card-border': '#e9d9bb',
    '--rsv-card-shadow': '0 28px 70px -30px rgba(7,25,28,0.75)',
    '--rsv-ink': '#1d130c',
    '--rsv-text': '#4a382a',
    '--rsv-muted': '#8a7a64',
    '--rsv-accent': '#e7723a',
    '--rsv-accent-hover': '#df5a35',
    '--rsv-accent-ink': '#fbf6ec',
    '--rsv-accent-shadow': '0 14px 30px -12px rgba(231,114,58,0.85)',
    '--rsv-strong': '#b3411c',
    '--rsv-gold': '#f4b454',
    '--rsv-surface': '#f6ecd9',
    '--rsv-field-bg': '#ffffff',
    '--rsv-field-border': '#e2c9a0',
    '--rsv-placeholder': '#b7a888',
    '--rsv-note': '#a86a2e',
    '--rsv-danger': '#b3411c',
    '--rsv-danger-bg': '#fdecec',
    '--rsv-welcome-bg': '#fff4e6',
    // mapa de mesas
    '--rsv-mesa-line': '#e7dcc9',
    '--rsv-mesa-panel': '#fdfaf4',
    '--rsv-mesa-livre': '#ffffff',
    '--rsv-mesa-livre-ink': '#5a4a38',
    '--rsv-mesa-off': '#f2ede2',
    '--rsv-mesa-off-ink': '#b3a686',
    '--rsv-mesa-ocupada': '#f7ecea',
    '--rsv-mesa-ocupada-line': '#e8d5d0',
    '--rsv-mesa-ocupada-ink': '#c79a94',
    '--rsv-mesa-sel': '#b3411c',
    '--rsv-mesa-sel-ink': '#ffffff',
    '--rsv-mesa-dim-ink': '#c2b8a3',
    '--rsv-agua': '#eef6fb',
    '--rsv-agua-ink': '#7fb0cf',
    '--rsv-agua-line': '#dde9f0',
  },
};

const TABUARA: TemaReserva = {
  fonte: 'playfair',
  marca: 'Tabuará',
  titulo: 'Sua mesa na cidade servida à mesa.',
  subtitulo:
    'Cozinha autoral, coquetelaria e carta de vinhos na Coroa do Meio. Reserve em 1 minuto e a gente prepara a sua noite.',
  bullets: ['🍷 Carta de vinhos e coquetelaria', '🍽️ Cozinha autoral do chef', '📍 Praça de Eventos, Coroa do Meio'],
  convite: 'gastronomia sensorial',
  emoji: '🍷',
  vars: {
    '--rsv-bg':
      'linear-gradient(180deg,#080706 0%,#14110c 38%,#1e1810 66%,#0d0b09 100%)',
    '--rsv-glow':
      'radial-gradient(circle, rgba(217,189,130,0.22) 0%, rgba(201,162,75,0.08) 42%, transparent 68%)',
    '--rsv-vignette':
      'radial-gradient(120% 90% at 50% 30%, transparent 40%, rgba(5,4,3,0.72) 100%)',
    '--rsv-brand': '#f6f0e6',
    '--rsv-brand-dot': '#c9a24b',
    '--rsv-on-bg': '#e4dccd',
    '--rsv-card-bg': '#14110d',
    '--rsv-card-border': 'rgba(201,162,75,0.24)',
    '--rsv-card-shadow': '0 28px 70px -30px rgba(0,0,0,0.9)',
    '--rsv-ink': '#f3ede1',
    '--rsv-text': '#c8bda9',
    '--rsv-muted': '#8f8574',
    '--rsv-accent': '#c9a24b',
    '--rsv-accent-hover': '#d9bd82',
    '--rsv-accent-ink': '#0d0b09',
    '--rsv-accent-shadow': '0 14px 30px -12px rgba(201,162,75,0.6)',
    '--rsv-strong': '#d9bd82',
    '--rsv-gold': '#c9a24b',
    '--rsv-surface': '#1b1712',
    '--rsv-field-bg': '#100e0b',
    '--rsv-field-border': 'rgba(201,162,75,0.3)',
    '--rsv-placeholder': '#6f6659',
    '--rsv-note': '#b8ad99',
    '--rsv-danger': '#e39179',
    '--rsv-danger-bg': 'rgba(200,80,60,0.16)',
    '--rsv-welcome-bg': 'rgba(201,162,75,0.12)',
    // mapa de mesas
    '--rsv-mesa-line': 'rgba(201,162,75,0.25)',
    '--rsv-mesa-panel': '#100e0b',
    '--rsv-mesa-livre': '#1b1712',
    '--rsv-mesa-livre-ink': '#e4dccd',
    '--rsv-mesa-off': '#141210',
    '--rsv-mesa-off-ink': '#6f6659',
    '--rsv-mesa-ocupada': 'rgba(200,80,60,0.16)',
    '--rsv-mesa-ocupada-line': 'rgba(200,80,60,0.32)',
    '--rsv-mesa-ocupada-ink': '#a8776a',
    '--rsv-mesa-sel': '#c9a24b',
    '--rsv-mesa-sel-ink': '#0d0b09',
    '--rsv-mesa-dim-ink': '#5c554b',
    '--rsv-agua': 'rgba(127,151,171,0.14)',
    '--rsv-agua-ink': '#7f97ab',
    '--rsv-agua-line': 'rgba(127,151,171,0.25)',
  },
};

/**
 * Escolhe o tema pelo nome da filial (o nome vem do cadastro; "Tabuará",
 * "Tabuara", "TABUARÁ" caem todos no mesmo). Qualquer outra casa fica no
 * Prainha, que é o visual que já estava no ar.
 */
export function temaDaFilial(nomeFilial: string): TemaReserva {
  const n = nomeFilial
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (n.includes('tabuara')) return TABUARA;
  return PRAINHA;
}
