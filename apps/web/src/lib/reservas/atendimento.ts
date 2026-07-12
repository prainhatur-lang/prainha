// Janela de atendimento do sistema de reserva: quando o site aceita pedido
// de reserva, independe da área/mesa. Duas regras (ver ReservaConfig.atendimento):
//  1. Janela geral (inicio–fim): fora dela, nenhum pedido é aceito, pra
//     nenhuma data.
//  2. Corte extra pra pedido do MESMO DIA em fim de semana/feriado
//     (fimHojeFimDeSemana) — a casa enche mais rápido nesses dias. Reservar
//     um fds/feriado FUTURO com antecedência não é afetado, só usa a janela
//     geral.

import type { ReservaConfig } from '@concilia/db/schema';
import { hojeBr, horaAgoraBr } from '@/lib/datas';
import { ehDiaEspecial } from './feriados';

export async function foraDaJanelaAtendimento(
  cfg: ReservaConfig | null | undefined,
  dataAlvo: string,
): Promise<{ bloqueado: boolean; motivo?: string }> {
  const atendimento = cfg?.atendimento;
  if (!atendimento) return { bloqueado: false };

  const agoraHora = horaAgoraBr();

  // 1) Janela geral — vale pra qualquer data sendo pedida.
  if (agoraHora < atendimento.inicio || agoraHora > atendimento.fim) {
    return {
      bloqueado: true,
      motivo: `Reservas só de ${atendimento.inicio} às ${atendimento.fim}. Tente de novo dentro desse horário.`,
    };
  }

  // 2) Corte extra: só se a data pedida é HOJE e hoje é fim de semana/feriado.
  if (dataAlvo === hojeBr() && (await ehDiaEspecial(dataAlvo)) && agoraHora > atendimento.fimHojeFimDeSemana) {
    return {
      bloqueado: true,
      motivo: `Reserva pra hoje só até ${atendimento.fimHojeFimDeSemana} em fim de semana/feriado. Chegue e aguarde mesa, ou reserve pra outro dia.`,
    };
  }

  return { bloqueado: false };
}
