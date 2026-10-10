// Google Wallet: cartão "Generic" — link "Salvar no Google Wallet" (JWT
// assinado) e atualização do objeto quando código/nível mudam.
//
// Envs (Vercel, Production):
//   GOOGLE_WALLET_ISSUER_ID  Issuer ID do Google Pay & Wallet Console (só dígitos)
//   GOOGLE_WALLET_SA_JSON    JSON da service account (pode ser em base64) — a
//                            conta tem que estar autorizada no console do issuer

import { createSign } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { baseUrl, REGRAS_TEXTO, vistaCartao } from './vista';
import { codigoDaCarteira } from './nucleo';

type Cartao = typeof schema.fidelidadeCartao.$inferSelect;

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export function googleConfigurada(): boolean {
  return !!(process.env.GOOGLE_WALLET_ISSUER_ID && process.env.GOOGLE_WALLET_SA_JSON);
}

function sa(): ServiceAccount {
  const bruto = (process.env.GOOGLE_WALLET_SA_JSON || '').trim();
  const json = bruto.startsWith('{') ? bruto : Buffer.from(bruto, 'base64').toString('utf8');
  const o = JSON.parse(json) as ServiceAccount;
  if (!o.client_email || !o.private_key) throw new Error('GOOGLE_WALLET_SA_JSON sem client_email/private_key');
  return o;
}

const issuer = () => (process.env.GOOGLE_WALLET_ISSUER_ID || '').trim();
const classId = () => `${issuer()}.prainha_fidelidade`;
const objectId = (c: Cartao) => `${issuer()}.cartao_${c.id.replace(/-/g, '')}`;

function b64url(x: Buffer | string): string {
  return Buffer.from(x).toString('base64url');
}

function jwtRs256(payload: object, chave: string): string {
  const cab = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify(payload));
  const ass = createSign('RSA-SHA256').update(`${cab}.${corpo}`).sign(chave);
  return `${cab}.${corpo}.${b64url(ass)}`;
}

function txt(v: string) {
  return { defaultValue: { language: 'pt-BR', value: v } };
}

function classe() {
  return {
    id: classId(),
    classTemplateInfo: {
      cardTemplateOverride: {
        cardRowTemplateInfos: [
          {
            twoItems: {
              startItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['desconto']" }] } },
              endItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['visitas']" }] } },
            },
          },
          {
            oneItem: {
              item: { firstValue: { fields: [{ fieldPath: "object.textModulesData['proximo']" }] } },
            },
          },
        ],
      },
    },
  };
}

async function objeto(c: Cartao) {
  const v = await vistaCartao(c);
  // código na frente do cartão: é o que o cliente digita no Pix. Troca sozinho
  // depois de cada pagamento (atualizarGoogle regrava o objeto).
  const codigo = v.bloqueado ? '' : await codigoDaCarteira(c);
  return {
    id: objectId(c),
    classId: classId(),
    state: v.bloqueado ? 'INACTIVE' : 'ACTIVE',
    hexBackgroundColor: v.cor,
    logo: { sourceUri: { uri: `${baseUrl()}/fidelidade/logo-google.png` }, contentDescription: txt(v.casa) },
    cardTitle: txt(`${v.marca} · ${v.nivel}`),
    // o desconto continua na linha de baixo (textModulesData 'desconto')
    subheader: txt(v.bloqueado ? 'Desconto no Pix' : 'Código pra pagar no Pix'),
    header: txt(v.bloqueado ? 'Bloqueado' : codigo),
    textModulesData: [
      { id: 'desconto', header: 'Desconto', body: v.textoDesconto },
      { id: 'visitas', header: `Visitas (${v.janelaDias} dias)`, body: String(v.visitas) },
      { id: 'proximo', header: 'Próximo nível', body: v.textoProximo },
      { id: 'membro', header: 'Cliente VIP', body: `${v.nome} · nº ${v.numero}` },
      { id: 'regras', header: 'Como funciona', body: REGRAS_TEXTO(v) },
    ],
    linksModuleData: { uris: [{ uri: v.link, description: 'O código não passou? Gere outro aqui', id: 'site' }] },
    heroImage: { sourceUri: { uri: `${baseUrl()}/fidelidade/sereia-branca.png` }, contentDescription: txt('Prainha') },
  };
}

/** URL "Salvar no Google Wallet" — a classe e o objeto vão dentro do JWT, o
 *  Google cria na primeira vez. */
export async function linkSalvarGoogle(c: Cartao): Promise<string> {
  const conta = sa();
  const jwt = jwtRs256(
    {
      iss: conta.client_email,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      origins: [baseUrl()],
      payload: { genericClasses: [classe()], genericObjects: [await objeto(c)] },
    },
    conta.private_key,
  );
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

let cacheToken: { token: string; ate: number } | null = null;

async function tokenApi(): Promise<string> {
  if (cacheToken && cacheToken.ate > Date.now() + 60_000) return cacheToken.token;
  const conta = sa();
  const agora = Math.floor(Date.now() / 1000);
  const assertion = jwtRs256(
    {
      iss: conta.client_email,
      scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
      aud: 'https://oauth2.googleapis.com/token',
      iat: agora,
      exp: agora + 3600,
    },
    conta.private_key,
  );
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!r.ok || !j.access_token) throw new Error(`OAuth Google: ${r.status} ${j.error || ''}`);
  cacheToken = { token: j.access_token, ate: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

/** Regrava o objeto no Google (se a pessoa já salvou o cartão). */
export async function atualizarGoogle(cartaoId: string): Promise<boolean> {
  if (!googleConfigurada()) return false;
  const [c] = await db.select().from(schema.fidelidadeCartao).where(eq(schema.fidelidadeCartao.id, cartaoId)).limit(1);
  if (!c || !c.googleSalvoEm) return false;
  const token = await tokenApi();
  const obj = await objeto(c);
  const r = await fetch(
    `https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${encodeURIComponent(obj.id)}`,
    {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(obj),
    },
  );
  if (r.status === 404) return false; // clicou em salvar mas não concluiu
  if (!r.ok) throw new Error(`Google Wallet PUT ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return true;
}
