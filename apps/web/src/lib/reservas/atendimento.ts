// Janela de atendimento do restaurante pra reserva: horário do DIA em que a
// mesa pode ser reservada, independe da área específica. Três regras (ver
// ReservaConfig.atendimento):
//  1. Janela geral (inicio–fim): a HORA PEDIDA pra reserva precisa cair
//     dentro dela — não tem a ver com o horário em que o pedido é enviado
//     (alguém pode pedir uma mesa das 14h à noite, de manhã, não importa).
//  2. Corte de fim de semana/feriado (fimHojeFimDeSemana): nesses dias a
//     janela fecha mais cedo — a HORA PEDIDA não pode passar desse horário,
//     não importa com quanta antecedência o pedido chegou. Regra do Elison
//     15/08: sábado, domingo e feriado à tarde a casa é por ordem de chegada,
//     reserva só até o corte (antes disso, sábado 16h passava se o pedido
//     tivesse sido feito na véspera).
//  3. O mesmo corte também vale sobre a hora REAL de agora quando a data
//     pedida é HOJE e hoje é fds/feriado: passou do corte, não entra mais
//     reserva pro próprio dia.
//
// `horaAlvo` é opcional: quando ausente (checagem de disponibilidade do DIA,
// antes do cliente escolher hora), só a regra 3 é aplicada — use
// `horaMaximaDoDia` pra saber até que horas o dia aceita reserva.

import type { ReservaConfig } from '@concilia/db/schema';
import { hojeBr, horaAgoraBr } from '@/lib/datas';
import { ehDiaEspecial } from './feriados';

/** Até que hora essa data aceita reserva: em fim de semana/feriado vale o
 *  corte curto (fimHojeFimDeSemana); nos outros dias, o fim da janela geral.
 *  null = sem janela configurada (sem restrição de horário). */
export async function horaMaximaDoDia(
  cfg: ReservaConfig | null | undefined,
  data: string,
): Promise<string | null> {
  const a = cfg?.atendimento;
  if (!a) return null;
  if (await ehDiaEspecial(data)) return a.fimHojeFimDeSemana < a.fim ? a.fimHojeFimDeSemana : a.fim;
  return a.fim;
}

export async function foraDaJanelaAtendimento(
  cfg: ReservaConfig | null | undefined,
  dataAlvo: string,
  horaAlvo?: string,
): Promise<{ bloqueado: boolean; motivo?: string }> {
  const atendimento = cfg?.atendimento;
  if (!atendimento) return { bloqueado: false };

  // 1+2) A hora PEDIDA precisa estar na janela do dia — que em fds/feriado
  //      fecha no corte curto.
  if (horaAlvo) {
    if (horaAlvo < atendimento.inicio) {
      return {
        bloqueado: true,
        motivo: `Reservas só a partir de ${atendimento.inicio}. Escolha um horário dentro da janela.`,
      };
    }
    const maxima = (await horaMaximaDoDia(cfg, dataAlvo)) ?? atendimento.fim;
    if (horaAlvo > maxima) {
      return {
        bloqueado: true,
        motivo:
          maxima === atendimento.fim
            ? `Reservas só de ${atendimento.inicio} às ${atendimento.fim}. Escolha um horário dentro dessa janela.`
            : `Em sábado, domingo e feriado a reserva vai só até ${maxima}. Depois desse horário a casa é por ordem de chegada — é só vir direto que a recepção acomoda.`,
      };
    }
  }

  // 3) Corte extra: só se a data pedida é HOJE e hoje é fim de semana/feriado,
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
