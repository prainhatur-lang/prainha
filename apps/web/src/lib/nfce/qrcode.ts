// QR Code v2 da NFC-e (emissão ONLINE) + URL de consulta por chave.
//
// p = chNFe|versaoQR|tpAmb|idCSC|hash
// hash = SHA-1(chNFe|versaoQR|tpAmb|idCSC + CSC) em hex MAIÚSCULO.
// idCSC entra SEM zeros à esquerda ("000001" -> "1").
//
// URLs por UF (versão 2.0). Só SE cadastrada por ora — o resto entra quando precisar.

import { createHash } from 'node:crypto';

const URLS: Record<string, { qr: [string, string]; consulta: [string, string] }> = {
  // [produção, homologação]
  SE: {
    qr: ['https://www.nfce.se.gov.br/nfce/qrcode', 'https://www.hom.nfe.se.gov.br/nfce/qrcode'],
    consulta: ['www.nfce.se.gov.br/nfce/consulta', 'www.hom.nfe.se.gov.br/nfce/consulta'],
  },
};

export function montarQrCode(p: {
  uf: string;
  chave: string;
  tpAmb: 1 | 2;
  cscId: string;
  cscToken: string;
}): { qrcode: string; urlChave: string } {
  const cfg = URLS[p.uf.toUpperCase()];
  if (!cfg) throw new Error(`UF ${p.uf} sem URL de QR Code cadastrada (lib/nfce/qrcode.ts)`);
  const idx = p.tpAmb === 1 ? 0 : 1;
  const idCsc = String(Number(String(p.cscId).replace(/\D/g, '') || '0'));
  if (idCsc === '0') throw new Error('CSC id inválido');
  const seq = `${p.chave}|2|${p.tpAmb}|${idCsc}`;
  const hash = createHash('sha1').update(seq + p.cscToken, 'utf8').digest('hex').toUpperCase();
  return {
    qrcode: `${cfg.qr[idx]}?p=${seq}|${hash}`,
    urlChave: cfg.consulta[idx],
  };
}
