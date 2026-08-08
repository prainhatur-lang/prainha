// Transcricao de audio do WhatsApp (ogg/opus) via OpenAI, mesma key do OCR.
// Retorna null se nao configurado ou falhou — o motor pede por escrito.

import OpenAI, { toFile } from 'openai';

export async function transcreverAudio(buffer: Buffer, mime: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const client = new OpenAI({ apiKey });
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : mime.includes('mpeg') ? 'mp3' : 'ogg';
    const file = await toFile(buffer, `audio.${ext}`, { type: mime });
    const r = await client.audio.transcriptions.create({
      file,
      model: process.env.ATENDIMENTO_MODELO_AUDIO || 'whisper-1',
      language: 'pt',
    });
    const texto = r.text?.trim();
    return texto || null;
  } catch {
    return null;
  }
}
