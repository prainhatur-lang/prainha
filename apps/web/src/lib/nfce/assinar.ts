// Assinatura XMLDSig da NFC-e — mesmo padrão do sefaz-evento.ts (que já
// assina manifestações em produção): xml-crypto, RSA-SHA1, c14n, enveloped.
//
// A Reference aponta pro infNFe (URI #NFe<chave>) e a <Signature> entra como
// último filho do <NFe> (depois do infNFeSupl).

import { SignedXml } from 'xml-crypto';
import type { PemCert } from '@/lib/sefaz-evento';

export function assinarNfe(nfeXml: string, pem: PemCert): string {
  const sig = new SignedXml({
    privateKey: pem.privateKeyPem,
    publicCert: pem.certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });

  sig.addReference({
    xpath: "//*[local-name(.)='infNFe']",
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });

  sig.computeSignature(nfeXml, {
    location: {
      reference: "//*[local-name(.)='NFe']",
      action: 'append',
    },
  });

  return sig.getSignedXml();
}
