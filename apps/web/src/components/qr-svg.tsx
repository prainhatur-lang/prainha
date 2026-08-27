// QR code gerado localmente (server component) — nunca manda o conteúdo
// pra um terceiro tipo api.qrserver.com, que vazaria o token na URL.

import QRCode from 'qrcode-svg';

export function QrSvg({ content, size = 180 }: { content: string; size?: number }) {
  const svg = new QRCode({ content, padding: 0, width: size, height: size, ecl: 'M', join: true }).svg();
  return <div className="inline-block rounded-lg border border-slate-200 p-2" dangerouslySetInnerHTML={{ __html: svg }} />;
}
