// Funcionamento POR CASA (dono 09/11/2026, caso Valéria no Tabuará) — cada
// casa tem suas janelas por dia da semana (índice 0 = domingo), com intervalo
// no meio do dia quando houver; fecha '23:59' = "até o último cliente".
// O Prainha Bar (e qualquer filial fora deste mapa) fica de fora: nele valem
// as regras próprias (corte dinâmico, janela de atendimento), intocadas.
//
// Usado em dois lugares:
//  - lib/atendimento/ocupacao.ts: resumo "casa aberta/fechada AGORA" do
//    prompt da Nina (fix do caso Valéria, commit 0b3d7967).
//  - validação da HORA PEDIDA da reserva (caso Dudu, 10/11/2026: o Otávio
//    recusava jantar às 20:30 no Tabuará — horaLimite 18:00 copiado do Bar —
//    e, sem este check, corrigir o horaLimite deixaria passar reserva às 16h
//    com a casa fechada no intervalo 15h–18h de seg–qui).

export interface JanelaDia {
  abre: string;
  fecha: string;
}
const J = (abre: string, fecha: string): JanelaDia => ({ abre, fecha });

// Tabuará (bloco "Sobre o Tabuará" da base da Nina): seg–qui 12h–15h e
// 18h–23h; sexta e sábado das 12h até o último cliente; domingo 12h–22h.
const TABUARA_SEMANA = [J('12:00', '15:00'), J('18:00', '23:00')];
const FUNCIONAMENTO: Record<string, JanelaDia[][]> = {
  // Tabuará
  'fde37b95-7c7e-4b41-a618-2aba1fbc0de7': [
    [J('12:00', '22:00')], // dom
    TABUARA_SEMANA, // seg
    TABUARA_SEMANA, // ter
    TABUARA_SEMANA, // qua
    TABUARA_SEMANA, // qui
    [J('12:00', '23:59')], // sex
    [J('12:00', '23:59')], // sáb
  ],
  // Prainha Mar: abre todos os dias às 12h (bloco da base; o fechamento exato
  // está PENDENTE lá). Fechamento pelo movimento real dos pedidos (15 dias,
  // lido em 09/11/2026): domingo ~21h, seg–qui ~22h, sexta/sábado ~23h.
  'e899dae2-38bf-4f3f-9149-7effd059fab8': [
    [J('12:00', '21:00')], // dom
    [J('12:00', '22:00')], // seg
    [J('12:00', '22:00')], // ter
    [J('12:00', '22:00')], // qua
    [J('12:00', '22:00')], // qui
    [J('12:00', '23:00')], // sex
    [J('12:00', '23:00')], // sáb
  ],
};

/** Janelas de funcionamento da filial nesse dia, ou null se a filial não
 *  está no mapa (Bar e demais: nenhum comportamento novo). */
export function janelasFuncionamento(filialId: string, ymd: string): JanelaDia[] | null {
  const f = FUNCIONAMENTO[filialId];
  if (!f) return null;
  const [a, m, d] = ymd.split('-').map(Number);
  return f[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? null;
}

export function textoJanelas(janelas: JanelaDia[]): string {
  return janelas
    .map((j) => (j.fecha === '23:59' ? `das ${j.abre} até o último cliente` : `das ${j.abre} às ${j.fecha}`))
    .join(' e ');
}

/** HORA PEDIDA da reserva fora do funcionamento do dia → texto do motivo
 *  (com as janelas certas pra oferecer alternativa); dentro (ou filial fora
 *  do mapa) → null. Reservar NA hora de fechar não vale ('<' no fecha);
 *  fecha '23:59' não limita (o horaLimite da área segue valendo por cima). */
export function horaForaDoFuncionamento(filialId: string, ymd: string, hora: string): string | null {
  const janelas = janelasFuncionamento(filialId, ymd);
  if (!janelas || janelas.length === 0) return null;
  const dentro = janelas.some((j) => hora >= j.abre && (j.fecha === '23:59' || hora < j.fecha));
  if (dentro) return null;
  return `Nesse dia a casa funciona ${textoJanelas(janelas)} — ${hora} cai fora do funcionamento.`;
}
