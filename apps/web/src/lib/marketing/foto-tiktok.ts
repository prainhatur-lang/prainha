// Foto que o TikTok busca pelo link (PULL_FROM_URL): só JPEG/WebP e no máximo
// 1080p. A foto do Instagram vem com 1440 px e o TikTok recusava calado
// (21/10/2026). Aqui vira JPEG com o lado menor ≤ 1080 e o maior ≤ 1920.

import sharp from 'sharp';

export async function fotoParaTiktok(original: Uint8Array): Promise<Buffer> {
  const img = sharp(original, { failOn: 'none' }).rotate();
  const { width = 0, height = 0 } = await img.metadata();
  const deitada = width > height;
  return img
    .resize({
      width: deitada ? 1920 : 1080,
      height: deitada ? 1080 : 1920,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}
