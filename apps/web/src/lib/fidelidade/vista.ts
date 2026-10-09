// O que aparece no cartão (página pública, Apple e Google usam o mesmo texto).

import { schema } from '@concilia/db';
import { dadosDoCartao, nomeCurto } from './nucleo';
import { formatarNumero } from './codigo';

type Cartao = typeof schema.fidelidadeCartao.$inferSelect;

export function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.prainhabar.com').replace(/\/+$/, '');
}

export interface VistaCartao {
  nome: string;
  nomeCurto: string;
  numero: string;
  /** "Prainha Bar" */
  casa: string;
  /** "Cliente VIP Prainha Bar" */
  marca: string;
  bloqueado: boolean;
  nivel: string;
  nivelCodigo: string;
  cor: string;
  pct: number;
  bonusDiaUtil: number;
  /** bônus vale hoje? */
  bonusHoje: number;
  visitas: number;
  janelaDias: number;
  garantido: boolean;
  /** dd/mm/aaaa em que a categoria do convite deixa de valer ('' = sem data) */
  garantidoAte: string;
  proximo: string | null;
  faltam: number;
  textoDesconto: string;
  textoProximo: string;
  niveis: Array<{ nome: string; minVisitas: number; pct: number; cor: string; pctEspaco: number; prioridadeReserva: boolean }>;
  /** % no aluguel de espaço do nível atual */
  pctEspaco: number;
  prioridadeReserva: boolean;
  aderido: boolean;
  link: string;
}

export async function vistaCartao(cartao: Cartao): Promise<VistaCartao> {
  const { cfg, estado, bonus, prog } = await dadosDoCartao(cartao);
  const pct = estado.nivel.pct;
  const textoDesconto = cfg.bonusDiaUtilPct
    ? `${pct}% · ${pct + cfg.bonusDiaUtilPct}% seg–sex`
    : `${pct}%`;
  const textoProximo = estado.proximo
    ? `${estado.proximo.nome} em ${estado.faltam} visita${estado.faltam === 1 ? '' : 's'}`
    : 'Nível máximo';
  return {
    nome: cartao.nome,
    nomeCurto: nomeCurto(cartao.nome),
    numero: formatarNumero(cartao.numero),
    casa: prog.casa,
    marca: prog.marca,
    bloqueado: cartao.status !== 'ativo',
    nivel: estado.nivel.nome,
    nivelCodigo: estado.nivel.codigo,
    cor: estado.nivel.cor,
    pct,
    bonusDiaUtil: cfg.bonusDiaUtilPct,
    bonusHoje: bonus,
    visitas: estado.visitas,
    janelaDias: cfg.janelaDias,
    garantido: estado.garantido,
    garantidoAte: estado.garantido && cartao.nivelMinimoAte
      ? String(cartao.nivelMinimoAte).slice(0, 10).split('-').reverse().join('/')
      : '',
    proximo: estado.proximo?.nome ?? null,
    faltam: estado.faltam,
    textoDesconto,
    textoProximo,
    niveis: cfg.niveis.map((n) => ({
      nome: n.nome, minVisitas: n.minVisitas, pct: n.pct, cor: n.cor,
      pctEspaco: n.pctEspaco, prioridadeReserva: n.prioridadeReserva,
    })),
    pctEspaco: estado.nivel.pctEspaco,
    prioridadeReserva: estado.nivel.prioridadeReserva,
    aderido: !!cartao.aderidoEm,
    link: `${baseUrl()}/cartao/${cartao.token}`,
  };
}

export const REGRAS_TEXTO = (v: VistaCartao) =>
  [
    `Como usar: na hora de pagar a conta no Pix (QR da mesa ou no caixa), abra o seu cartão no celular e toque em "Vou pagar agora". Aparece um código de 4 letras que vale 1 minuto: digite na tela do Pix. O desconto de ${v.pct}% sai na hora sobre o consumo (a taxa de serviço continua sobre o valor cheio).`,
    v.bonusDiaUtil ? `De segunda a sexta (fora feriado) você ganha +${v.bonusDiaUtil}% extra.` : '',
    'O cartão é pessoal: o código só é gerado no celular confirmado pelo WhatsApp do seu número, muda a cada pagamento e não serve pra outra pessoa.',
    `Vale 1 uso por dia, só no ${v.casa}, pagando no Pix. Cada casa do grupo tem o seu próprio Cliente VIP.`,
    v.prioridadeReserva ? `Prioridade nas reservas do ${v.casa}: quando as mesas reserváveis da área acabam, você ainda consegue reservar (se houver mesa livre).` : '',
    v.pctEspaco ? `Aniversário, confraternização ou evento no ${v.casa}: ${v.pctEspaco}% de desconto no aluguel do espaço. Peça o orçamento pelo WhatsApp com o mesmo telefone do cartão.` : '',
    `Seu nível sobe com as visitas dos últimos ${v.janelaDias} dias: ` +
      v.niveis.map((n) => `${n.nome} ${n.pct}% (${n.minVisitas}+)`).join(' · ') + '.',
  ].filter(Boolean).join('\n\n');
