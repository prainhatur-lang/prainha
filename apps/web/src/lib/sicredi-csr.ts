// Pedido de certificado (CSR) da API Pix da Sicredi gerado pelo próprio sistema.
//
// Pedido do dono (12/11/2026, SaaS): a casa não deve lidar com chave privada.
// O sistema gera a chave RSA 2048, guarda cifrada (filial_credencial, chave
// 'keyPendente') e entrega o .csr pra enviar no portal Sicredi (ibpj →
// Gerenciar certificado). Quando a Sicredi devolve o .cer, a tela confere se
// ele bate com a chave gerada e promove 'keyPendente' → 'key'.
//
// Subject no padrão que a Sicredi aprovou pras três casas (sem serialNumber
// com o CNPJ ela reprova).

import * as forge from 'node-forge';
import { X509Certificate, createPublicKey, generateKeyPairSync } from 'node:crypto';

function slug(nome: string): string {
  return (
    nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 40) || 'empresa'
  );
}

/** Gera chave privada (PEM PKCS#1) + CSR (PEM) pra API Pix da Sicredi. */
export function gerarCsrSicredi(cnpj: string, nomeEmpresa: string): { keyPem: string; csrPem: string } {
  const doc = cnpj.replace(/\D/g, '');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = forge.pki.publicKeyFromPem(publicKey);
  const P = forge.asn1.Type.PRINTABLESTRING;
  const U = forge.asn1.Type.UTF8;
  csr.setSubject([
    { shortName: 'C', value: 'BR', valueTagClass: P },
    { shortName: 'O', value: 'Confederacao Interestadual das Cooperativas Ligadas ao Sicredi', valueTagClass: U },
    { shortName: 'CN', value: `api-parceiros-${slug(nomeEmpresa)}.sicredi.net`, valueTagClass: U },
    { shortName: 'ST', value: 'RS', valueTagClass: U },
    { shortName: 'L', value: 'Porto Alegre', valueTagClass: U },
    { type: '1.3.6.1.4.1.311.60.2.1.3', value: 'BR', valueTagClass: P },
    { shortName: 'OU', value: 'API Pix Sicredi', valueTagClass: U },
    { type: '2.5.4.5', value: `urn:cpfcnpj:${doc}`, valueTagClass: P },
  ] as unknown as forge.pki.CertificateField[]);
  csr.sign(forge.pki.privateKeyFromPem(privateKey) as forge.pki.rsa.PrivateKey, forge.md.sha256.create());
  return { keyPem: privateKey, csrPem: forge.pki.certificationRequestToPem(csr) };
}

/** base64 (como a tela grava) → PEM, aceitando .cer em DER ou PEM. */
function certPem(b64: string): string {
  const buf = Buffer.from(b64.trim(), 'base64');
  if (buf.toString('latin1').includes('-----BEGIN')) return buf.toString('latin1');
  return `-----BEGIN CERTIFICATE-----\n${buf.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/** O .cer (base64) é dessa chave privada (base64 do PEM)? */
export function certBateComChave(certB64: string, keyB64: string): boolean {
  try {
    const c = new X509Certificate(certPem(certB64)).publicKey.export({ type: 'spki', format: 'der' });
    const k = createPublicKey(Buffer.from(keyB64.trim(), 'base64').toString('latin1')).export({ type: 'spki', format: 'der' });
    return Buffer.compare(c, k) === 0;
  } catch {
    return false;
  }
}

/** O arquivo é um certificado legível? */
export function certValido(certB64: string): { ok: boolean; validoAte?: string; sujeito?: string } {
  try {
    const x = new X509Certificate(certPem(certB64));
    return { ok: true, validoAte: x.validTo, sujeito: x.subject };
  } catch {
    return { ok: false };
  }
}
