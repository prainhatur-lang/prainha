// Janela de atendimento do restaurante pra reserva: horário do DIA em que a
// mesa pode ser reservada, independe da área específica. Duas regras (ver
// ReservaConfig.atendimento):
//  1. Janela geral (inicio–fim): a HORA PEDIDA pra reserva precisa cair
//     dentro dela — não tem a ver com o horário em que o pedido é enviado
//     (alguém pode pedir uma mesa das 14h à noite, de manhã, não importa).
//  2. Corte extra pra pedido do MESMO DIA em fim de semana/feriado
//     (fimHojeFimDeSemana) — esse sim é sobre a hora REAL de agora: depois
//     desse horário a casa já enche demais pra aceitar reserva de última
//     hora pro próprio dia. Reservar um fds/feriado FUTURO com antecedência
//     não é afetado, só usa a janela geral (regra 1).
//
// `horaAlvo` é opcional: quando ausente (checagem de disponibilidade do DIA,
// antes do cliente escolher hora), só a regra 2 é aplicada.

import type { ReservaConfig } from '@concilia/db/schema';
import { hojeBr, horaAgoraBr } from '@/lib/datas';
import { ehDiaEspecial } from './feriados';

export async function foraDaJanelaAtendimento(
  cfg: ReservaConfig | null | undefined,
  dataAlvo: string,
  horaAlvo?: string,
): Promise<{ bloqueado: boolean; motivo?: string }> {
  const atendimento = cfg?.atendimento;
  if (!atendimento) return { bloqueado: false };

  // 1) Janela geral — a hora PEDIDA pra reserva precisa estar dentro dela.
  if (horaAlvo && (horaAlvo < atendimento.inicio || horaAlvo > atendimento.fim)) {
    return {
      bloqueado: true,
      motivo: `Reservas só de ${atendimento.inicio} às ${atendimento.fim}. Escolha um horário dentro dessa janela.`,
    };
  }

  // 2) Corte extra: só se a data pedida é HOJE e hoje é fim de semana/feriado,
  //    baseado na hora REAL de agora (não na hora pedida pra reserva).
  const agoraHora = horaAgoraBr();
  if (dataAlvo === hojeBr() && (await ehDiaEspecial(dataAlvo)) && agoraHora > atendimento.fimHojeFimDeSemana) {
    return {
      bloqueado: true,
      motivo: `Reserva pra hoje só até ${atendimento.fimHojeFimDeSemana} em fim de semana/feriado. Chegue e aguarde mesa, ou reserve pra outro dia.`,
    };
  }

  return { bloqueado: false };
}
