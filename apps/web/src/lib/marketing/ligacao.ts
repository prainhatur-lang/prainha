// Ligação de CADA casa com as redes sociais (Instagram e TikTok): as chaves que
// a rede devolve no "Conectar" e quem é a conta.
//
// Mora em filial_credencial (provedor 'instagram' / 'tiktok'), igual Cielo,
// iFood e Google — tudo cifrado (AES-256-GCM, @/lib/segredo), sem migration.
// Post, curtida e seguidor NÃO são gravados: a tela lê ao vivo da rede.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { cifrar, decifrar, pista, segredoConfigurado } from '@/lib/segredo';

export type Rede = 'instagram' | 'tiktok';
export const REDES: Rede[] = ['instagram', 'tiktok'];

export function ehRede(x: string): x is Rede {
  return x === 'instagram' || x === 'tiktok';
}

export interface LigacaoRede {
  accessToken: string;
  /** TikTok tem; Instagram renova o próprio accessToken (fica vazio) */
  refreshToken: string;
  /** ISO — quando o accessToken vence */
  expiraEm: string;
  /** ISO — quando o refreshToken vence (TikTok) */
  refreshExpiraEm: string;
  /** id da conta na rede (Instagram user_id / TikTok open_id) */
  contaId: string;
  /** @ da conta, pra pessoa conferir que é a casa certa */
  usuario: string;
  /** escopos que a pessoa aceitou */
  escopos: string;
}

const CHAVES: (keyof LigacaoRede)[] = [
  'accessToken',
  'refreshToken',
  'expiraEm',
  'refreshExpiraEm',
  'contaId',
  'usuario',
  'escopos',
];

const vazia = (): LigacaoRede => ({
  accessToken: '',
  refreshToken: '',
  expiraEm: '',
  refreshExpiraEm: '',
  contaId: '',
  usuario: '',
  escopos: '',
});

/** Ligações das casas pedidas, já decifradas. Mapa por `${filialId}:${rede}`. */
export async function ligacoesRedes(filialIds: string[]): Promise<Map<string, LigacaoRede>> {
  const out = new Map<string, LigacaoRede>();
  if (filialIds.length === 0 || !segredoConfigurado()) return out;
  const linhas = await db
    .select({
      filialId: schema.filialCredencial.filialId,
      provedor: schema.filialCredencial.provedor,
      chave: schema.filialCredencial.chave,
      valor: schema.filialCredencial.valor,
    })
    .from(schema.filialCredencial)
    .where(
      and(
        inArray(schema.filialCredencial.filialId, filialIds),
        inArray(schema.filialCredencial.provedor, REDES),
      ),
    );
  for (const l of linhas) {
    let valor = '';
    try {
      valor = decifrar(l.valor);
    } catch {
      continue; // CREDENCIAL_SECRET trocada: trata como "não ligado"
    }
    const k = `${l.filialId}:${l.provedor}`;
    const atual = out.get(k) ?? vazia();
    if ((CHAVES as string[]).includes(l.chave)) atual[l.chave as keyof LigacaoRede] = valor;
    out.set(k, atual);
  }
  for (const [k, l] of out) if (!l.accessToken) out.delete(k);
  return out;
}

export async function ligacaoRede(filialId: string, rede: Rede): Promise<LigacaoRede | null> {
  return (await ligacoesRedes([filialId])).get(`${filialId}:${rede}`) ?? null;
}

/** Grava (ou troca) os campos informados da ligação. */
export async function salvarLigacaoRede(
  filialId: string,
  rede: Rede,
  campos: Partial<LigacaoRede>,
  userId: string | null,
) {
  for (const chave of CHAVES) {
    const valor = campos[chave];
    if (valor === undefined) continue;
    const linha = {
      valor: cifrar(valor),
      pista: chave === 'usuario' || chave.endsWith('Em') ? valor.slice(0, 40) : pista(valor),
      atualizadoPor: userId,
    };
    await db
      .insert(schema.filialCredencial)
      .values({ filialId, provedor: rede, chave, ...linha })
      .onConflictDoUpdate({
        target: [
          schema.filialCredencial.filialId,
          schema.filialCredencial.provedor,
          schema.filialCredencial.chave,
        ],
        set: { ...linha, atualizadoEm: new Date() },
      });
  }
}

export async function apagarLigacaoRede(filialId: string, rede: Rede) {
  await db
    .delete(schema.filialCredencial)
    .where(and(eq(schema.filialCredencial.filialId, filialId), eq(schema.filialCredencial.provedor, rede)));
}

/** Todas as ligações de todas as casas (cron de renovação). */
export async function todasLigacoesRedes(): Promise<Array<{ filialId: string; rede: Rede; l: LigacaoRede }>> {
  const ids = await db
    .selectDistinct({ filialId: schema.filialCredencial.filialId })
    .from(schema.filialCredencial)
    .where(inArray(schema.filialCredencial.provedor, REDES));
  const mapa = await ligacoesRedes(ids.map((i) => i.filialId));
  return [...mapa].map(([k, l]) => {
    const [filialId, rede] = k.split(':') as [string, Rede];
    return { filialId, rede, l };
  });
}

// ── state assinado do OAuth ────────────────────────────────────────────────
// Leva a casa, a rede e quem clicou. Assinado com CREDENCIAL_SECRET (a mesma
// que cifra as chaves), vale 15 min. Sem tabela nem cookie.

function assinatura(corpo: string): string {
  return createHmac('sha256', `marketing:${process.env.CREDENCIAL_SECRET ?? ''}`)
    .update(corpo)
    .digest('base64url');
}

export function gerarEstado(filialId: string, rede: Rede, userId: string): string {
  const corpo = Buffer.from(JSON.stringify({ f: filialId, r: rede, u: userId, t: Date.now() })).toString(
    'base64url',
  );
  return `${corpo}.${assinatura(corpo)}`;
}

export function lerEstado(state: string): { filialId: string; rede: Rede; userId: string } | null {
  const [corpo, sig] = state.split('.');
  if (!corpo || !sig) return null;
  const esperado = Buffer.from(assinatura(corpo));
  const veio = Buffer.from(sig);
  if (esperado.length !== veio.length || !timingSafeEqual(esperado, veio)) return null;
  try {
    const j = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as {
      f?: string;
      r?: string;
      u?: string;
      t?: number;
    };
    if (!j.f || !j.u || !j.r || !ehRede(j.r) || !j.t || Date.now() - j.t > 15 * 60 * 1000) return null;
    return { filialId: j.f, rede: j.r, userId: j.u };
  } catch {
    return null;
  }
}

/** Endereço público do app (rodando local, usa o do pedido). */
export function baseDoApp(origemDoPedido: string): string {
  try {
    const h = new URL(origemDoPedido).hostname;
    if (h === 'localhost' || h === '127.0.0.1') return origemDoPedido.replace(/\/+$/, '');
  } catch {
    // cai no público
  }
  return ((process.env.NEXT_PUBLIC_APP_URL ?? '').trim() || 'https://app.prainhabar.com').replace(/\/+$/, '');
}

/** Tem que ser IGUAL à cadastrada no app da Meta / do TikTok. */
export function uriDeRetornoRede(rede: Rede, origemDoPedido: string): string {
  return `${baseDoApp(origemDoPedido)}/api/marketing/${rede}/callback`;
}
