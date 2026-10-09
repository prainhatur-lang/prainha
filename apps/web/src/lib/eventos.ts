// Benefício de EVENTO: quem veio pra um evento da cidade se cadastra numa
// página pública (CPF + celular) e sai com um Cliente VIP da CASA (Prainha Bar
// ou Tabuará — cada casa tem o seu cartão) já na categoria garantida até o fim
// do evento.
//
//   81ª SOEA (Semana Oficial da Engenharia e da Agronomia) — 13 a 16/10/2026,
//     o público fica até domingo 18/10 → soea.prainhabar.com
//     · a mesma SOEA na Tabuará → tabuara.com.br/soea (Cliente VIP Tabuará)
//   27º Jipe Show de Sergipe (Jipe Clube de Sergipe) — 8 a 11/10/2026, com o
//     feriado de segunda 12/10 → jipeshow.prainhabar.com
//
// O drink de boas-vindas NÃO é controlado aqui: é o "Avalie e ganhe um drink"
// do QR da mesa (vendas-local) — a pessoa avalia a casa com o CPF, escolhe o
// drink e ele entra na conta a R$ 0, um por CPF por mês. O cartão só avisa.
//
// Nada de tabela nova: o cartão do evento é um fidelidade_cartao comum, com
// origem = slug do evento e a TAG em origem_detalhe.
//
// Evento novo = uma entrada em EVENTOS + pasta app/<slug> (layout + page) +
// app/api/<slug>/route.ts + o host no proxy.ts.

import { schema } from '@concilia/db';
import { hojeBr } from '@/lib/datas';
import type { FidelidadeConfig, NivelFidelidade } from '@/lib/fidelidade/config';

type Cartao = typeof schema.fidelidadeCartao.$inferSelect;

/** A casa do benefício: marca, links e as cores da página. */
export interface Casa {
  /** "Prainha Bar" — como aparece em frase */
  nome: string;
  /** letreiro do topo */
  letreiro: string;
  sub: string;
  /** "No Prainha" / "Na Tabuará" */
  na: string;
  /** "do Prainha" / "da Tabuará" */
  da: string;
  /** "o Prainha" / "a Tabuará" */
  a: string;
  /** no meio da frase, com o nome inteiro: "no Prainha Bar" / "na Tabuará" */
  noNome: string;
  /** "o Prainha Bar" / "a Tabuará" */
  oNome: string;
  foto: string;
  fotoAlt: string;
  /** object-position da foto de abertura */
  fotoPos: string;
  sobre: string;
  /** frase de quando o benefício já encerrou */
  depois: string;
  reservas: string;
  site: string;
  siteRotulo: string;
  instagram: string;
  instagramRotulo: string;
  maps: string;
  endereco: string;
  tema: { acento: string; fundo: string; painel: string; botao1: string; botao2: string; botaoTexto: string };
}

export const CASAS = {
  prainha: {
    nome: 'Prainha Bar',
    letreiro: 'Prainha',
    sub: 'Bar e restaurante',
    na: 'No Prainha',
    da: 'do Prainha',
    a: 'o Prainha',
    noNome: 'no Prainha Bar',
    oNome: 'o Prainha Bar',
    foto: '/soea/por-do-sol.jpg',
    fotoAlt: 'Pôr do sol sobre o rio, visto do Prainha Bar, em Aracaju',
    fotoPos: '50% 45%',
    sobre: 'Mesas na areia, à beira do rio, com música ao vivo, moqueca de camarão e o pôr do sol mais bonito da cidade. Entrada gratuita.',
    depois: 'O pôr do sol continua todos os dias. Reserve sua mesa.',
    reservas: 'https://reservas.prainhabar.com',
    site: 'https://www.prainhabar.com',
    siteRotulo: 'prainhabar.com',
    instagram: 'https://www.instagram.com/prainha.se/',
    instagramRotulo: '@prainha.se',
    maps: 'https://www.google.com/maps/search/?api=1&query=Prainha+Bar+Matapoa+Aracaju',
    endereco: 'Estrada Matapoã, 2288 · Mosqueiro, Aracaju/SE',
    tema: { acento: '#F2C27A', fundo: '#160c08', painel: '#1d110b', botao1: '#F2A65A', botao2: '#E0782A', botaoTexto: '#2A1408' },
  },
  tabuara: {
    nome: 'Tabuará',
    letreiro: 'Tabuará',
    sub: 'Gastronomia sensorial',
    na: 'Na Tabuará',
    da: 'da Tabuará',
    a: 'a Tabuará',
    noNome: 'na Tabuará',
    oNome: 'a Tabuará',
    foto: '/tabuara/ambiente.jpg',
    fotoAlt: 'Salão da Tabuará, na Coroa do Meio, em Aracaju',
    fotoPos: '50% 30%',
    sobre: 'Cozinha autoral, coquetelaria e carta de vinhos, num ambiente sofisticado na Coroa do Meio, em Aracaju.',
    depois: 'A casa continua de portas abertas. Reserve sua mesa.',
    reservas: 'https://tabuara.com.br/reserva',
    site: 'https://tabuara.com.br',
    siteRotulo: 'tabuara.com.br',
    instagram: 'https://instagram.com/tabuara.se',
    instagramRotulo: '@tabuara.se',
    maps: 'https://www.google.com/maps/search/?api=1&query=Tabuara+Praca+de+Eventos+Coroa+do+Meio+Aracaju',
    endereco: 'Praça de Eventos · Coroa do Meio, Aracaju/SE',
    tema: { acento: '#d9bd82', fundo: '#0d0b09', painel: '#15120e', botao1: '#d9bd82', botao2: '#c9a24b', botaoTexto: '#0d0b09' },
  },
} as const satisfies Record<string, Casa>;

export interface Evento {
  /** rota (/soea), API (/api/soea) e fidelidade_cartao.origem */
  slug: string;
  host: string;
  filialId: string;
  casa: Casa;
  /** marca em origem_detalhe */
  tag: string;
  inicio: string;
  /** último dia do cadastro e da categoria garantida */
  fim: string;
  /** categoria garantida até `fim` */
  nivel: string;
  cookie: string;
  /** "81ª SOEA" — selo do topo e textos */
  nome: string;
  /** "da 81ª SOEA" / "do 27º Jipe Show" */
  doEvento: string;
  /** "13 a 18 de outubro" */
  periodo: string;
  /** "18/10" */
  fimCurto: string;
  /** "13 a 18/10/2026" */
  periodoRodape: string;
  titulo: [string, string];
  /** começo da frase de abertura: "<chamada> um drink de boas-vindas e X% …" */
  chamada: string;
  /** abertura do convite no cartão */
  saudacao: string;
}

/** 01 Prainha Bar */
const PRAINHA_BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
/** 02 Tabuará */
const TABUARA = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';

export const EVENTOS = {
  soea: {
    slug: 'soea',
    host: 'soea.prainhabar.com',
    filialId: PRAINHA_BAR,
    casa: CASAS.prainha,
    tag: 'soea81',
    inicio: '2026-10-13',
    fim: '2026-10-18',
    nivel: 'platinum',
    cookie: 'soea_t',
    nome: '81ª SOEA',
    doEvento: 'da 81ª SOEA',
    periodo: '13 a 18 de outubro',
    fimCurto: '18/10',
    periodoRodape: '13 a 18/10/2026',
    titulo: ['O pôr do sol de Aracaju', 'é à beira-rio.'],
    chamada: 'Participante da SOEA é convidado da casa:',
    saudacao: 'Boas-vindas a Aracaju!',
  },
  jipeshow: {
    slug: 'jipeshow',
    host: 'jipeshow.prainhabar.com',
    filialId: PRAINHA_BAR,
    casa: CASAS.prainha,
    tag: 'jipeshow27',
    inicio: '2026-10-08',
    fim: '2026-10-12',
    nivel: 'platinum',
    cookie: 'jipeshow_t',
    nome: '27º Jipe Show',
    doEvento: 'do 27º Jipe Show',
    periodo: 'Até 12 de outubro',
    fimCurto: '12/10',
    periodoRodape: 'até 12/10/2026',
    titulo: ['Depois da trilha,', 'o pôr do sol é à beira-rio.'],
    chamada: 'Quem veio para o Jipe Show é convidado da casa:',
    saudacao: 'Boas-vindas ao Prainha!',
  },
  // A SOEA na Tabuará (tabuara.com.br/soea): Cliente VIP TABUARÁ — outro
  // cartão, outra casa. A tag não pode conter a da SOEA do Prainha ("soea81").
  tabuaraSoea: {
    slug: 'tabuara-soea',
    host: 'tabuara.com.br',
    filialId: TABUARA,
    casa: CASAS.tabuara,
    tag: 'soeatab81',
    inicio: '2026-10-13',
    fim: '2026-10-18',
    nivel: 'platinum',
    cookie: 'tabuara_soea_t',
    nome: '81ª SOEA',
    doEvento: 'da 81ª SOEA',
    periodo: '13 a 18 de outubro',
    fimCurto: '18/10',
    periodoRodape: '13 a 18/10/2026',
    titulo: ['Aracaju servida', 'à mesa.'],
    chamada: 'Participante da SOEA é convidado da casa:',
    saudacao: 'Boas-vindas a Aracaju!',
  },
} as const satisfies Record<string, Evento>;

const LISTA: Evento[] = Object.values(EVENTOS);

/** Cadastro aberto até o último dia. */
export function eventoAberto(ev: Evento): boolean {
  return hojeBr() <= ev.fim;
}

export function ehDoEvento(c: Pick<Cartao, 'origemDetalhe'>, ev: Evento): boolean {
  return (c.origemDetalhe ?? '').includes(ev.tag);
}

/** O evento EM ANDAMENTO (até o último dia) em que este cartão entrou — se
 *  entrou em mais de um, o que termina primeiro. */
export function eventoDoCartao(c: Pick<Cartao, 'origemDetalhe' | 'filialId'>): Evento | null {
  const h = hojeBr();
  return LISTA.filter((ev) => ev.filialId === c.filialId && ehDoEvento(c, ev) && h <= ev.fim).sort((a, b) => a.fim.localeCompare(b.fim))[0] ?? null;
}

/** O cartão NASCEU num cadastro de evento (não é cliente antigo que ganhou o benefício). */
export function nasceuEmEvento(c: Pick<Cartao, 'origem'>): boolean {
  return LISTA.some((ev) => ev.slug === c.origem);
}

/** A categoria do benefício: a configurada (platinum); se a casa renomeou os
 *  níveis, a primeira com 10% ou mais; senão a mais alta. */
export function nivelDoEvento(cfg: FidelidadeConfig, ev: Evento): NivelFidelidade {
  return (
    cfg.niveis.find((n) => n.codigo === ev.nivel) ??
    cfg.niveis.find((n) => n.pct >= 10) ??
    cfg.niveis[cfg.niveis.length - 1]
  );
}

export function cpfValido(x: unknown): string | null {
  const d = String(x ?? '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]) ? d : null;
}
