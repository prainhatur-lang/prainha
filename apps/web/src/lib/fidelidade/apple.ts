// Apple Wallet: gera o .pkpass assinado e manda push quando o cartão muda.
//
// Envs (Vercel, Production):
//   APPLE_PASS_TYPE_ID    pass.com.prainhabar.fidelidade (o Pass Type ID criado no developer.apple.com)
//   APPLE_TEAM_ID         Team ID (10 caracteres)
//   APPLE_PASS_P12        o .p12 do certificado do Pass Type ID, em base64
//   APPLE_PASS_P12_SENHA  senha do .p12
//   APPLE_WWDR_PEM        (opcional) intermediário WWDR G4 em PEM; sem ele baixa da Apple
//
// O push usa o MESMO certificado do pass (APNs com tópico = Pass Type ID);
// o aparelho recebe e busca o pass novo no web service /api/wallet/apple/v1/...

import { createHash } from 'node:crypto';
import http2 from 'node:http2';
import * as forge from 'node-forge';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { PASS_IMAGENS } from './assets';
import { zipStore } from './zip';
import { REGRAS_TEXTO, baseUrl, vistaCartao } from './vista';

type Cartao = typeof schema.fidelidadeCartao.$inferSelect;

interface Credencial {
  passTypeId: string;
  teamId: string;
  cert: forge.pki.Certificate;
  key: forge.pki.PrivateKey;
  wwdr: forge.pki.Certificate;
  certPem: string;
  keyPem: string;
}

export function appleConfigurada(): boolean {
  return !!(process.env.APPLE_PASS_TYPE_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_PASS_P12);
}

let cacheCred: Promise<Credencial> | null = null;

async function baixarWwdr(): Promise<forge.pki.Certificate> {
  const pem = process.env.APPLE_WWDR_PEM;
  if (pem && pem.includes('BEGIN CERTIFICATE')) return forge.pki.certificateFromPem(pem);
  const r = await fetch('https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer');
  if (!r.ok) throw new Error(`WWDR G4: HTTP ${r.status}`);
  const der = Buffer.from(await r.arrayBuffer());
  return forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(der.toString('binary'))));
}

function lerP12(b64: string, senha: string) {
  const der = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(der.toString('binary'))), false, senha);
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [])
    .map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c);
  let key = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;
  if (!key) key = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0]?.key;
  if (!key || !certs.length) throw new Error('APPLE_PASS_P12 sem certificado ou chave');
  // o export do Keychain pode trazer a cadeia junto: fica com o que casa com a chave
  const n = (key as forge.pki.rsa.PrivateKey).n;
  const cert = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(n)) ?? certs[0];
  return { cert, key };
}

function credencial(): Promise<Credencial> {
  if (!cacheCred) {
    cacheCred = (async () => {
      if (!appleConfigurada()) throw new Error('Apple Wallet não configurada (APPLE_PASS_TYPE_ID/APPLE_TEAM_ID/APPLE_PASS_P12)');
      const { cert, key } = lerP12(process.env.APPLE_PASS_P12!, process.env.APPLE_PASS_P12_SENHA || '');
      const wwdr = await baixarWwdr();
      return {
        passTypeId: process.env.APPLE_PASS_TYPE_ID!.trim(),
        teamId: process.env.APPLE_TEAM_ID!.trim(),
        cert, key, wwdr,
        certPem: forge.pki.certificateToPem(cert),
        keyPem: forge.pki.privateKeyToPem(key),
      };
    })();
    cacheCred.catch(() => { cacheCred = null; });
  }
  return cacheCred;
}

export async function passTypeId(): Promise<string> {
  return process.env.APPLE_PASS_TYPE_ID?.trim() || '';
}

function rgb(hex: string): string {
  const h = hex.replace('#', '');
  return `rgb(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)})`;
}

function assinar(manifest: Buffer, c: Credencial): Buffer {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest.toString('binary'));
  p7.addCertificate(c.cert);
  p7.addCertificate(c.wwdr);
  p7.addSigner({
    key: c.key as forge.pki.rsa.PrivateKey,
    certificate: c.cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      // o forge aceita Date aqui, apesar do tipo dizer string
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}

/** Gera o .pkpass do cartão. */
export async function gerarPkpass(cartao: Cartao): Promise<Buffer> {
  const c = await credencial();
  const v = await vistaCartao(cartao);
  const fg = 'rgb(255,255,255)';
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: c.passTypeId,
    teamIdentifier: c.teamId,
    serialNumber: cartao.id,
    organizationName: v.casa,
    description: `${v.marca} — desconto no Pix`,
    logoText: v.marca,
    foregroundColor: fg,
    labelColor: 'rgb(235,235,235)',
    backgroundColor: rgb(v.cor),
    webServiceURL: `${baseUrl()}/api/wallet/apple`,
    authenticationToken: cartao.appleAuthToken,
    sharingProhibited: true,
    ...(v.bloqueado ? { voided: true } : {}),
    storeCard: {
      headerFields: [
        { key: 'nivel', label: 'NÍVEL', value: v.nivel, changeMessage: 'Seu cartão agora é %@!' },
      ],
      // sem código no pass: ele nasce no celular do dono, na hora de pagar
      primaryFields: [
        { key: 'desconto', label: 'DESCONTO NO PIX', value: v.bloqueado ? 'BLOQUEADO' : v.textoDesconto },
      ],
      secondaryFields: [
        { key: 'nome', label: 'CLIENTE VIP', value: v.nomeCurto },
        { key: 'pagar', label: 'NA HORA DE PAGAR', value: 'Toque ⓘ › Abrir o cartão', textAlignment: 'PKTextAlignmentRight' },
      ],
      auxiliaryFields: [
        { key: 'visitas', label: `VISITAS (${v.janelaDias} DIAS)`, value: v.visitas },
        { key: 'proximo', label: 'PRÓXIMO NÍVEL', value: v.textoProximo, textAlignment: 'PKTextAlignmentRight' },
      ],
      backFields: [
        { key: 'regras', label: 'Como funciona', value: REGRAS_TEXTO(v) },
        { key: 'numero', label: 'Número do cartão', value: v.numero },
        { key: 'link', label: 'Gerar o código pra pagar', value: v.link, attributedValue: `<a href="${v.link}">Abrir o cartão — Vou pagar agora</a>` },
      ],
    },
  };

  const arquivos: Array<{ nome: string; dados: Buffer }> = [
    { nome: 'pass.json', dados: Buffer.from(JSON.stringify(pass), 'utf8') },
    ...Object.entries(PASS_IMAGENS).map(([nome, b64]) => ({ nome, dados: Buffer.from(b64, 'base64') })),
  ];
  const manifest: Record<string, string> = {};
  for (const a of arquivos) manifest[a.nome] = createHash('sha1').update(a.dados).digest('hex');
  const manifestBuf = Buffer.from(JSON.stringify(manifest), 'utf8');
  arquivos.push({ nome: 'manifest.json', dados: manifestBuf });
  arquivos.push({ nome: 'signature', dados: assinar(manifestBuf, c) });
  return zipStore(arquivos);
}

/** Push (vazio) pra cada aparelho que guardou o cartão — o iPhone então
 *  pede o pass novo. Token morto (410) sai do cadastro. */
export async function pushApple(cartaoId: string): Promise<number> {
  if (!appleConfigurada()) return 0;
  const regs = await db
    .select()
    .from(schema.fidelidadeAppleRegistro)
    .where(eq(schema.fidelidadeAppleRegistro.cartaoId, cartaoId));
  if (!regs.length) return 0;
  const c = await credencial();
  const sessao = http2.connect('https://api.push.apple.com:443', { cert: c.certPem, key: c.keyPem });
  let ok = 0;
  try {
    await Promise.all(regs.map((r) => new Promise<void>((resolve) => {
      const req = sessao.request({
        ':method': 'POST',
        ':path': `/3/device/${r.pushToken}`,
        'apns-topic': c.passTypeId,
        'content-type': 'application/json',
      });
      let status = 0;
      req.setTimeout(10_000, () => { req.close(); resolve(); });
      req.on('response', (h) => { status = Number(h[':status']) || 0; });
      req.on('data', () => {});
      req.on('end', async () => {
        if (status === 200) ok++;
        else if (status === 410) {
          await db.delete(schema.fidelidadeAppleRegistro).where(eq(schema.fidelidadeAppleRegistro.id, r.id)).catch(() => {});
        } else console.error('[fidelidade] APNs', status, r.deviceId);
        resolve();
      });
      req.on('error', (e) => { console.error('[fidelidade] APNs erro', e.message); resolve(); });
      req.end('{}');
    })));
  } finally {
    sessao.close();
  }
  return ok;
}
