// Decide se /clima/[token] está aberto pra resposta — SEMPRE no servidor,
// nunca aceita competência do cliente (evita responder por um mês passado
// ou futuro fora da janela real).

import { hojeBr } from '@/lib/datas';

export interface JanelaClima {
  aberto: boolean;
  /** 'YYYY-MM' — competência que a resposta de hoje vai contar. */
  competencia: string;
}

/** climaDiasJanela: dias a partir do dia 1 do mês em que a pesquisa fica
 *  aberta (ex: 7 = primeira semana). climaAbertoAte: data até quando fica
 *  aberto FORA da janela normal, pra rodadas extraordinárias. */
export function janelaClima(climaDiasJanela: number, climaAbertoAte: string | null): JanelaClima {
  const hoje = hojeBr();
  const [ano, mes, diaStr] = hoje.split('-');
  const dia = Number(diaStr);
  const competencia = `${ano}-${mes}`;

  if (climaAbertoAte && hoje <= climaAbertoAte) {
    return { aberto: true, competencia };
  }
  return { aberto: dia <= climaDiasJanela, competencia };
}
