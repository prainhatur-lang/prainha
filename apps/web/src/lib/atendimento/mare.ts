// Tábua de maré simplificada (regra do Elison, 16/08): o AquaArena pode
// PAUSAR na maré baixa dos dias de "maré grande" (segurança das crianças).
// Maré grande = sizígia (lua NOVA ou CHEIA, ±2 dias) — física das marés,
// calculada por fase da lua, sem API externa. A Nina NUNCA afirma que o
// parque estará fechado: só avisa que PODE pausar, e que a equipe no local
// orienta na hora.

const MES_SINODICO = 29.53058867; // dias entre luas novas
const EPOCA_LUA_NOVA_UTC = Date.UTC(2000, 0, 6, 18, 14); // lua nova de referência
const JANELA_SIZIGIA = 2.2; // dias em volta da lua nova/cheia

export interface AvaliacaoMare {
  fase: 'nova' | 'crescente' | 'cheia' | 'minguante';
  mareGrande: boolean;
}

export function avaliarMare(ymd: string): AvaliacaoMare | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  // meio-dia local (~15h UTC) evita ambiguidade de fuso na virada do dia
  const alvo = Date.parse(`${ymd}T15:00:00Z`);
  if (Number.isNaN(alvo)) return null;
  const idade = (((alvo - EPOCA_LUA_NOVA_UTC) / 86400000) % MES_SINODICO + MES_SINODICO) % MES_SINODICO;

  const pertoNova = idade < JANELA_SIZIGIA || idade > MES_SINODICO - JANELA_SIZIGIA;
  const pertoCheia = Math.abs(idade - MES_SINODICO / 2) < JANELA_SIZIGIA;

  const fase: AvaliacaoMare['fase'] = pertoNova
    ? 'nova'
    : pertoCheia
      ? 'cheia'
      : idade < MES_SINODICO / 2
        ? 'crescente'
        : 'minguante';

  return { fase, mareGrande: pertoNova || pertoCheia };
}

/** Texto pro modelo usar na conversa sobre o parque numa data. */
export function consultarMareTexto(ymd: string): string {
  const m = avaliarMare(ymd);
  if (!m) return 'Data inválida (use YYYY-MM-DD).';
  const dataBr = ymd.split('-').reverse().join('/');
  if (m.mareGrande) {
    return (
      `MARÉ GRANDE em ${dataBr} (lua ${m.fase} — maré de sizígia, enche e seca muito). ` +
      `Avise o cliente COM CARINHO: nesse dia, nos horários de maré baixa, alguns brinquedos do AquaArena PODEM dar uma pausa pela segurança das crianças — a equipe no local orienta na hora. ` +
      `NUNCA afirme que o parque estará fechado: é só um "pode acontecer", e o restante da estrutura (restaurante, areia, deck) funciona normal.`
    );
  }
  return `Maré tranquila em ${dataBr} (lua ${m.fase}, fora da sizígia) — sem aviso especial de pausa do parque; responda normalmente.`;
}
