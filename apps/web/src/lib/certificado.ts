// Utilitários pra lidar com certificado A1 (.pfx):
//  - Ler PFX e extrair CNPJ, CN, validade
//  - Criptografar/descriptografar senha do PFX com AES-256-GCM

import * as forge from 'node-forge';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export interface CertificadoInfo {
  cn: string;
  cnpjOuCpf: string | null;
  validadeInicio: Date;
  validadeFim: Date;
}

/** Lê um PFX (.p12) + senha, retorna metadados do certificado. */
export function lerPfx(pfxBytes: Buffer, senha: string): CertificadoInfo {
  const p12Der = forge.util.createBuffer(pfxBytes.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, senha);

  // Encontra o primeiro certificado (o do titular)
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const cert = certBags[forge.pki.oids.certBag]?.[0]?.cert;
  if (!cert) throw new Error('PFX sem certificado');

  // CN do subject
  const subject = cert.subject;
  const cnAttr = subject.attributes.find((a) => a.shortName === 'CN' || a.name === 'commonName');
  const cn = typeof cnAttr?.value === 'string' ? cnAttr.value : '';

  // CNPJ/CPF vem depois do nome e ":" no CN (ex: "PRAINHA TURISMO LTDA:33159574000166")
  let cnpjOuCpf: string | null = null;
  const m = cn.match(/:(\d{11,14})$/);
  if (m) cnpjOuCpf = m[1]!;

  // Fallback: tentar extensões otherName (CNPJ em extension id-icp-brasil)
  if (!cnpjOuCpf) {
    for (const ext of (cert.extensions ?? []) as Array<{ id?: string; altNames?: unknown[]; value?: unknown }>) {
      const ext2 = ext as { altNames?: Array<{ value?: string }> };
      if (ext2.altNames) {
        for (const a of ext2.altNames) {
          const v = typeof a?.value === 'string' ? a.value : '';
          const digits = v.replace(/\D/g, '');
          if (digits.length === 14) {
            cnpjOuCpf = digits;
            break;
          }
        }
        if (cnpjOuCpf) break;
      }
    }
  }

  return {
    cn,
    cnpjOuCpf,
    validadeInicio: cert.validity.notBefore,
    validadeFim: cert.validity.notAfter,
  };
}

/** Deriva chave AES de 32 bytes a partir do env CERTIFICATE_SECRET (+ salt fixo). */
function getKey(): Buffer {
  const secret = process.env.CERTIFICATE_SECRET;
  if (!secret) {
    throw new Error(
      'CERTIFICATE_SECRET nao configurado — defina 32+ chars no env var.',
    );
  }
  // scrypt com salt fixo pra determinismo (key binding) + secret forte
  return scryptSync(secret, 'concilia-cert-salt-v1', 32);
}

/** Criptografa uma senha com AES-256-GCM. Retorna base64(iv|tag|ciphertext). */
export function cifrarSenha(senha: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(senha, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Descriptografa uma senha criptografada por cifrarSenha. */
export function decifrarSenha(cifrada: string): string {
  const key = getKey();
  const buf = Buffer.from(cifrada, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}
