// Voz da Nina: gera mensagem de voz (TTS da OpenAI, mesma key) em ogg/opus —
// o formato que o WhatsApp toca como "mensagem de voz" (bolinha de áudio).
// Uso raro e afetivo (agradecer elogio, parabenizar) — regras no prompt.

import OpenAI from 'openai';

/** Direção de fala padrão — calibrada com o áudio-exemplo do Elison (15/08). */
export const INSTRUCAO_VOZ_NINA =
  'Português brasileiro. Voz feminina doce, meiga e acolhedora, com sorriso na voz — a Nina, atendente carinhosa de um restaurante à beira do rio. Ritmo natural de mensagem de voz de WhatsApp, sem exagero.';

export async function gerarAudioNina(
  texto: string,
  instrucoesOverride?: string,
): Promise<Buffer | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const fala = (texto ?? '').trim();
  if (!apiKey || !fala) return null;
  try {
    const client = new OpenAI({ apiKey });
    const model = process.env.ATENDIMENTO_MODELO_VOZ || 'gpt-4o-mini-tts';
    const resp = await client.audio.speech.create({
      model,
      voice: (process.env.ATENDIMENTO_VOZ || 'nova') as 'nova',
      input: fala.slice(0, 600),
      response_format: 'opus',
      // instructions só nos modelos que aceitam (gpt-4o-*)
      ...(model.includes('4o')
        ? { instructions: (instrucoesOverride ?? INSTRUCAO_VOZ_NINA).slice(0, 800) }
        : {}),
    });
    return Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    console.error('[nina] TTS falhou:', e instanceof Error ? e.message : e);
    return null;
  }
}
