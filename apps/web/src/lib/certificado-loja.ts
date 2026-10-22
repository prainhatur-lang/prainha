// Certificado válido pro vendas-local (22/10/2026).
//
// Com o certificado próprio do servidor (autoassinado) o Chrome mostra a página
// de "não é seguro" e o caixa instalado em https não fica em tela cheia. Aqui a
// nuvem tira um certificado do Let's Encrypt pra *.loja.prainhabar.com e cada
// loja baixa pela rota /api/loja/certificado.
//
// O DNS do prainhabar.com fica no Squarespace, que não tem API. Por isso o
// desafio do Let's Encrypt e o endereço de cada loja moram num domínio grátis
// do deSEC (DESEC_DOMINIO, ex.: prainha-lojas.dedyn.io), apontado uma vez só
// no Squarespace:
//   _acme-challenge.loja.prainhabar.com  CNAME  _acme-challenge.<DESEC_DOMINIO>
//   bar.loja.prainhabar.com              CNAME  bar.<DESEC_DOMINIO>
//   tabuara.loja.prainhabar.com          CNAME  tabuara.<DESEC_DOMINIO>
//   mar.loja.prainhabar.com              CNAME  mar.<DESEC_DOMINIO>
// O A de bar./tabuara./mar.<DESEC_DOMINIO> recebe o IP da rede local que a
// loja informa (192.168.x.x) — vale só dentro da loja, que é onde o caixa roda.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { Resolver } from 'node:dns/promises';
import * as acme from 'acme-client';

export const LOJA_DOMINIO = process.env.LOJA_DOMINIO || 'loja.prainhabar.com';
const CERT_ID = 'lojas';

/** Nome de cada casa dentro de loja.prainhabar.com. */
export const SLUG_FILIAL: Record<string, string> = {
  '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9': 'bar',
  'fde37b95-7c7e-4b41-a618-2aba1fbc0de7': 'tabuara',
  'e899dae2-38bf-4f3f-9149-7effd059fab8': 'mar',
};

function desec() {
  const token = process.env.DESEC_TOKEN;
  const dominio = (process.env.DESEC_DOMINIO || '').replace(/\.$/, '');
  if (!token || !dominio) throw new Error('faltam DESEC_TOKEN e DESEC_DOMINIO na Vercel');
  return { token, dominio };
}

type RRset = { subname: string; type: string; ttl?: number; records: string[] };

async function desecPatch(rrsets: RRset[]) {
  const { token, dominio } = desec();
  const r = await fetch(`https://desec.io/api/v1/domains/${dominio}/rrsets/`, {
    method: 'PATCH',
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(rrsets.map((x) => ({ ttl: 3600, ...x }))),
  });
  if (!r.ok) throw new Error(`deSEC ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

/** Resolver que pergunta direto pro servidor do deSEC (sem cache de resolvedor público). */
async function resolverDesec(): Promise<Resolver> {
  const pub = new Resolver();
  pub.setServers(['1.1.1.1', '8.8.8.8']);
  const ips = await pub.resolve4('ns1.desec.io');
  const r = new Resolver();
  r.setServers(ips);
  return r;
}

/** Confere no DNS público que o Squarespace já delega o desafio pro deSEC. */
export async function conferirDelegacao(): Promise<string | null> {
  const { dominio } = desec();
  const pub = new Resolver();
  pub.setServers(['1.1.1.1', '8.8.8.8']);
  const nome = `_acme-challenge.${LOJA_DOMINIO}`;
  try {
    const alvo = (await pub.resolveCname(nome)).map((x) => x.replace(/\.$/, '').toLowerCase());
    if (alvo.includes(`_acme-challenge.${dominio}`.toLowerCase())) return null;
    return `${nome} aponta pra ${alvo.join(', ')} — tem que ser _acme-challenge.${dominio}`;
  } catch {
    return `falta no Squarespace o registro CNAME ${nome} → _acme-challenge.${dominio}`;
  }
}

async function esperarTxt(valor: string) {
  const { dominio } = desec();
  const r = await resolverDesec();
  const fim = Date.now() + 150_000;
  while (Date.now() < fim) {
    try {
      const txt = (await r.resolveTxt(`_acme-challenge.${dominio}`)).map((p) => p.join(''));
      if (txt.includes(valor)) return;
    } catch {
      /* ainda não publicou */
    }
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  throw new Error('o deSEC não publicou o TXT do desafio em 150 s');
}

export type CertLoja = { cert_pem: string; key_pem: string; expira_em: string };

export async function certificadoAtual(): Promise<CertLoja | null> {
  const rows = (await db.execute(sql`
    SELECT cert_pem, key_pem, expira_em::text AS expira_em
      FROM loja_certificado WHERE id = ${CERT_ID} AND cert_pem IS NOT NULL AND expira_em > now()
  `)) as unknown as CertLoja[];
  return rows[0] ?? null;
}

/**
 * Emite (ou renova) o *.loja.prainhabar.com quando faltam menos de 30 dias ou
 * ainda não existe. Depois de um erro, espera 6 h pra tentar de novo (o Let's
 * Encrypt limita tentativas que falham).
 */
export async function renovarSePreciso(forcar = false): Promise<{ feito: boolean; motivo: string }> {
  const rows = (await db.execute(sql`
    SELECT acme_conta_key, expira_em > now() + interval '30 days' AS em_dia,
           ultima_tentativa > now() - interval '6 hours' AS tentou_agora, ultimo_erro
      FROM loja_certificado WHERE id = ${CERT_ID}
  `)) as unknown as Array<{ acme_conta_key: string | null; em_dia: boolean | null; tentou_agora: boolean | null; ultimo_erro: string | null }>;
  const atual = rows[0];
  if (!forcar && atual?.em_dia) return { feito: false, motivo: 'certificado em dia' };
  if (!forcar && atual?.tentou_agora && atual.ultimo_erro) return { feito: false, motivo: `aguardando depois do erro: ${atual.ultimo_erro}` };

  await db.execute(sql`
    INSERT INTO loja_certificado (id, dominio, ultima_tentativa) VALUES (${CERT_ID}, ${LOJA_DOMINIO}, now())
    ON CONFLICT (id) DO UPDATE SET ultima_tentativa = now(), atualizado_em = now()
  `);

  try {
    const falta = await conferirDelegacao();
    if (falta) throw new Error(falta);

    const contaKey = atual?.acme_conta_key || (await acme.crypto.createPrivateKey()).toString();
    if (!atual?.acme_conta_key) {
      await db.execute(sql`UPDATE loja_certificado SET acme_conta_key = ${contaKey} WHERE id = ${CERT_ID}`);
    }
    const client = new acme.Client({ directoryUrl: acme.directory.letsencrypt.production, accountKey: contaKey });
    const [key, csr] = await acme.crypto.createCsr({
      commonName: `*.${LOJA_DOMINIO}`,
      altNames: [`*.${LOJA_DOMINIO}`],
    });
    const cert = await client.auto({
      csr,
      email: process.env.ACME_EMAIL || undefined,
      termsOfServiceAgreed: true,
      challengePriority: ['dns-01'],
      // a verificação própria da lib usa o resolvedor público (cache negativo);
      // a nossa (esperarTxt) pergunta direto pro deSEC
      skipChallengeVerification: true,
      challengeCreateFn: async (_authz, _ch, keyAuthorization) => {
        await desecPatch([{ subname: '_acme-challenge', type: 'TXT', records: [`"${keyAuthorization}"`] }]);
        await esperarTxt(keyAuthorization);
      },
      challengeRemoveFn: async () => {
        await desecPatch([{ subname: '_acme-challenge', type: 'TXT', records: [] }]).catch(() => {});
      },
    });
    const info = acme.crypto.readCertificateInfo(cert);
    await db.execute(sql`
      UPDATE loja_certificado
         SET cert_pem = ${cert}, key_pem = ${key.toString()}, emitido_em = now(),
             expira_em = ${info.notAfter.toISOString()}::timestamptz, ultimo_erro = NULL, atualizado_em = now()
       WHERE id = ${CERT_ID}
    `);
    return { feito: true, motivo: `emitido, vence ${info.notAfter.toISOString().slice(0, 10)}` };
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 500);
    await db.execute(sql`UPDATE loja_certificado SET ultimo_erro = ${msg} WHERE id = ${CERT_ID}`);
    return { feito: false, motivo: msg };
  }
}

const IP_LOCAL = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

/** Grava o IP que a loja informou e publica no deSEC quando mudou. */
export async function publicarEnderecoLoja(filialId: string, ip: string): Promise<{ nome: string | null; erro?: string }> {
  const slug = SLUG_FILIAL[filialId];
  if (!slug) return { nome: null, erro: 'casa sem nome em loja.prainhabar.com' };
  const nome = `${slug}.${LOJA_DOMINIO}`;
  const ipOk = IP_LOCAL.test(ip) ? ip : null;
  const rows = (await db.execute(sql`
    INSERT INTO loja_endereco_local (filial_id, nome, ip, visto_em) VALUES (${filialId}::uuid, ${nome}, ${ipOk}, now())
    ON CONFLICT (filial_id) DO UPDATE SET nome = excluded.nome, ip = COALESCE(excluded.ip, loja_endereco_local.ip), visto_em = now()
    RETURNING ip, ip_publicado
  `)) as unknown as Array<{ ip: string | null; ip_publicado: string | null }>;
  const r = rows[0];
  if (!r?.ip || r.ip === r.ip_publicado) return { nome };
  try {
    await desecPatch([{ subname: slug, type: 'A', records: [r.ip] }]);
    await db.execute(sql`
      UPDATE loja_endereco_local SET ip_publicado = ${r.ip}, publicado_em = now(), ultimo_erro = NULL
       WHERE filial_id = ${filialId}::uuid`);
    return { nome };
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 300);
    await db.execute(sql`UPDATE loja_endereco_local SET ultimo_erro = ${msg} WHERE filial_id = ${filialId}::uuid`);
    return { nome, erro: msg };
  }
}
