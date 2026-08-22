// Tema do delivery por filial — irmão de app/reservar/[token]/tema.ts.
//
// O delivery da Tabuará não pode abrir na cara do Prainha (bege/laranja do
// pôr do sol): é a mesma marca que o cliente acabou de ver no site. Cada casa
// tem o seu, e o visual todo sai destas variáveis CSS.

export interface TemaDelivery {
  fonte: 'dm' | 'playfair';
  /** Marca no topo (o ponto sai na cor de destaque). */
  marca: string;
  vars: Record<string, string>;
}

const PRAINHA: TemaDelivery = {
  fonte: 'dm',
  marca: 'Prainha',
  vars: {
    '--dlv-page': '#fbf6ec',
    '--dlv-brand': '#b3411c',
    '--dlv-brand-dot': '#e7873a',
    '--dlv-card': '#ffffff',
    '--dlv-card-line': '#e2c9a0',
    '--dlv-ink': '#1d130c',
    '--dlv-text': '#4a382a',
    '--dlv-muted': '#8a7a64',
    '--dlv-accent': '#e7723a',
    '--dlv-accent-hover': '#df5a35',
    '--dlv-accent-ink': '#fbf6ec',
    '--dlv-strong': '#b3411c',
    '--dlv-gold': '#f4b454',
    '--dlv-surface': '#f0e4cc',
    '--dlv-surface-2': '#f6ecd9',
    '--dlv-field-bg': '#ffffff',
    '--dlv-placeholder': '#b7a888',
    '--dlv-escuro': '#143a3d',
    '--dlv-areia': '#c98a3f',
    '--dlv-linha-suave': '#e9d9bb',
    '--dlv-nota': '#a86a2e',
    '--dlv-capa': 'linear-gradient(180deg,#07191c 0%,#143a3d 55%,#5a6a4f 85%,#c98a3f 115%)',
  },
};

const TABUARA: TemaDelivery = {
  fonte: 'playfair',
  marca: 'Tabuará',
  vars: {
    '--dlv-page': '#0d0b09',
    '--dlv-brand': '#f6f0e6',
    '--dlv-brand-dot': '#c9a24b',
    '--dlv-card': '#14110d',
    '--dlv-card-line': 'rgba(201,162,75,0.24)',
    '--dlv-ink': '#f3ede1',
    '--dlv-text': '#c8bda9',
    '--dlv-muted': '#8f8574',
    '--dlv-accent': '#c9a24b',
    '--dlv-accent-hover': '#d9bd82',
    '--dlv-accent-ink': '#0d0b09',
    '--dlv-strong': '#d9bd82',
    '--dlv-gold': '#c9a24b',
    '--dlv-surface': '#1b1712',
    '--dlv-surface-2': '#100e0b',
    '--dlv-field-bg': '#100e0b',
    '--dlv-placeholder': '#6f6659',
    '--dlv-escuro': '#080706',
    '--dlv-areia': '#b8ad99',
    '--dlv-linha-suave': 'rgba(201,162,75,0.18)',
    '--dlv-nota': '#b8ad99',
    '--dlv-capa': 'linear-gradient(180deg,#080706 0%,#14110c 45%,#1e1810 80%,#0d0b09 115%)',
  },
};

/** Escolhe pelo nome da filial — "Tabuará", "Tabuara", "TABUARÁ" caem no mesmo.
 *  Qualquer outra casa fica no Prainha, que é o que já estava no ar. */
export function temaDeliveryDaFilial(nomeFilial: string): TemaDelivery {
  const n = nomeFilial.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (n.includes('tabuara')) return TABUARA;
  return PRAINHA;
}

/** Estilo pronto pro wrapper da página (variáveis + par de fontes). */
export function estiloTemaDelivery(t: TemaDelivery): Record<string, string> {
  return {
    ...t.vars,
    '--dlv-display': t.fonte === 'playfair' ? 'var(--dlv-playfair)' : 'var(--dlv-dm)',
    '--dlv-body': t.fonte === 'playfair' ? 'var(--dlv-inter)' : 'var(--dlv-hanken)',
    fontFamily: 'var(--dlv-body)',
    background: 'var(--dlv-page)',
  };
}
