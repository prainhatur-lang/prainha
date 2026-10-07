// Senha da aba "Histórico de faturamento" (VGV) — pedido do dono (06/10/2026):
// além da permissão, a aba só abre com uma senha que ELE cria.
//
// - A senha nunca fica gravada: só o hash (scrypt + sal aleatório).
// - Senha certa → o servidor entrega um "passe" assinado (HMAC) num cookie
//   httpOnly, preso ao usuário e à organização, que vale por VALIDADE_MS.
//   Sem passe válido a página não busca nem renderiza número nenhum.
// - Trocar a senha troca o segredo do HMAC → todo passe antigo morre.
// - 5 tentativas erradas trancam por 15 min (a tentativa é contada ANTES de
//   conferir, num UPDATE só — rajada de requisições não ganha tentativa extra).
// - Este arquivo não lê cookie (isso mora em faturamento-acesso-sessao.ts), pra
//   poder rodar fora do Next num teste.
//
// As funções que gravam aceitam um executor (`ex`) pra dar pra testar dentro de
// uma transação com rollback — o `db` do pacote é Proxy e não aceita monkeypatch.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export const COOKIE_HF = 'hf_passe';
/** Quanto tempo a aba fica aberta depois da senha. */
export const VALIDADE_MS = 2 * 60 * 60 * 1000;
export const SENHA_MIN = 6;
export const SENHA_MAX = 200;
export const MAX_TENTATIVAS = 5;
export const BLOQUEIO_MINUTOS = 15;

type Exec = Pick<typeof db, 'execute'>;

// ---------- Parte pura (sem banco) ----------

export function hashSenha(senha: string, saltHex?: string): { hash: string; salt: string } {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
  const hash = scryptSync(senha.normalize('NFKC'), salt, 64);
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

export function senhaConfere(senha: string, hashHex: string, saltHex: string): boolean {
  const a = Buffer.from(hashSenha(senha, saltHex).hash, 'hex');
  const b = Buffer.from(hashHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function novoSegredo(): string {
  return randomBytes(32).toString('hex');
}

function assinatura(corpo: string, segredoHex: string): Buffer {
  return createHmac('sha256', Buffer.from(segredoHex, 'hex')).update(corpo).digest();
}

/** Passe = base64url(JSON) + '.' + HMAC. Não leva dado nenhum da aba. */
export function assinarPasse(
  p: { orgId: string; userId: string; exp: number },
  segredoHex: string,
): string {
  const corpo = Buffer.from(JSON.stringify({ o: p.orgId, u: p.userId, e: p.exp })).toString(
    'base64url',
  );
  return `${corpo}.${assinatura(corpo, segredoHex).toString('base64url')}`;
}

/** Confere o passe e devolve até quando ele vale (ms) — null se não vale. */
export function conferirPasse(
  valor: string | undefined | null,
  segredoHex: string,
  orgId: string,
  userId: string,
  agora: number = Date.now(),
): number | null {
  if (!valor) return null;
  const ponto = valor.indexOf('.');
  if (ponto <= 0 || ponto !== valor.lastIndexOf('.')) return null;
  const corpo = valor.slice(0, ponto);
  const recebida = Buffer.from(valor.slice(ponto + 1), 'base64url');
  const esperada = assinatura(corpo, segredoHex);
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as {
      o?: unknown;
      u?: unknown;
      e?: unknown;
    };
    if (p.o !== orgId || p.u !== userId || typeof p.e !== 'number' || p.e <= agora) return null;
    return p.e;
  } catch {
    return null;
  }
}

export function passeValido(
  valor: string | undefined | null,
  segredoHex: string,
  orgId: string,
  userId: string,
  agora: number = Date.now(),
): boolean {
  return conferirPasse(valor, segredoHex, orgId, userId, agora) !== null;
}

export function validarSenhaNova(senha: unknown): string | null {
  if (typeof senha !== 'string') return 'informe a senha';
  if (senha.length < SENHA_MIN) return `a senha precisa de pelo menos ${SENHA_MIN} caracteres`;
  if (senha.length > SENHA_MAX) return 'senha longa demais';
  return null;
}

// ---------- Banco ----------

export interface AcessoLinha {
  segredo: string;
  bloqueadoAte: Date | null;
}

/** Linha da senha da organização (sem o hash) — null se o dono ainda não criou. */
export async function lerAcesso(orgId: string, ex: Exec = db): Promise<AcessoLinha | null> {
  const rows = (await ex.execute(sql`
    SELECT segredo,
           CASE WHEN bloqueado_ate > now()
                THEN (extract(epoch FROM bloqueado_ate) * 1000)::float8 END AS bloqueado_ms
      FROM faturamento_acesso
     WHERE organizacao_id = ${orgId}::uuid
  `)) as unknown as Array<{ segredo: string; bloqueado_ms: number | null }>;
  const r = rows[0];
  if (!r) return null;
  return {
    segredo: r.segredo,
    bloqueadoAte: r.bloqueado_ms === null ? null : new Date(Number(r.bloqueado_ms)),
  };
}

/** Primeira senha. Devolve o segredo, ou null se já existia senha (não troca). */
export async function criarSenha(
  orgId: string,
  userId: string,
  senha: string,
  ex: Exec = db,
): Promise<string | null> {
  const { hash, salt } = hashSenha(senha);
  const segredo = novoSegredo();
  const rows = (await ex.execute(sql`
    INSERT INTO faturamento_acesso (organizacao_id, senha_hash, senha_salt, segredo, definida_por)
    VALUES (${orgId}::uuid, ${hash}, ${salt}, ${segredo}, ${userId}::uuid)
    ON CONFLICT (organizacao_id) DO NOTHING
    RETURNING segredo
  `)) as unknown as Array<{ segredo: string }>;
  return rows[0]?.segredo ?? null;
}

/** Troca a senha (e o segredo — derruba os passes antigos). Devolve o segredo novo. */
export async function trocarSenha(
  orgId: string,
  userId: string,
  senha: string,
  ex: Exec = db,
): Promise<string | null> {
  const { hash, salt } = hashSenha(senha);
  const segredo = novoSegredo();
  const rows = (await ex.execute(sql`
    UPDATE faturamento_acesso
       SET senha_hash = ${hash}, senha_salt = ${salt}, segredo = ${segredo},
           tentativas = 0, bloqueado_ate = NULL,
           definida_por = ${userId}::uuid, definida_em = now()
     WHERE organizacao_id = ${orgId}::uuid
    RETURNING segredo
  `)) as unknown as Array<{ segredo: string }>;
  return rows[0]?.segredo ?? null;
}

export type Tentativa =
  | { estado: 'ok'; senhaHash: string; senhaSalt: string; segredo: string; restantes: number; ate: Date | null }
  | { estado: 'sem-senha' }
  | { estado: 'bloqueado'; ate: Date };

/**
 * Conta uma tentativa ANTES de conferir qualquer coisa, num UPDATE só — só
 * passa se não estiver trancado, e a 5ª seguida já sai trancada. Vale pra
 * senha da aba e pro "esqueci" (que confere a senha de login).
 */
export async function registrarTentativa(orgId: string, ex: Exec = db): Promise<Tentativa> {
  const rows = (await ex.execute(sql`
    UPDATE faturamento_acesso
       SET tentativas = CASE
             WHEN bloqueado_ate IS NOT NULL THEN 1
             ELSE tentativas + 1
           END,
           bloqueado_ate = CASE
             WHEN bloqueado_ate IS NOT NULL THEN NULL
             WHEN tentativas + 1 >= ${MAX_TENTATIVAS}::int
               THEN now() + ${BLOQUEIO_MINUTOS}::int * interval '1 minute'
             ELSE NULL
           END
     WHERE organizacao_id = ${orgId}::uuid
       AND (bloqueado_ate IS NULL OR bloqueado_ate <= now())
    RETURNING senha_hash, senha_salt, segredo, tentativas,
              (extract(epoch FROM bloqueado_ate) * 1000)::float8 AS bloqueado_ms
  `)) as unknown as Array<{
    senha_hash: string;
    senha_salt: string;
    segredo: string;
    tentativas: number;
    bloqueado_ms: number | null;
  }>;

  const r = rows[0];
  if (!r) {
    // Não atualizou: ou não existe senha, ou está trancado.
    const atual = await lerAcesso(orgId, ex);
    if (!atual) return { estado: 'sem-senha' };
    return { estado: 'bloqueado', ate: atual.bloqueadoAte ?? new Date(Date.now() + 60_000) };
  }
  const ate = r.bloqueado_ms === null ? null : new Date(Number(r.bloqueado_ms));
  return {
    estado: 'ok',
    senhaHash: r.senha_hash,
    senhaSalt: r.senha_salt,
    segredo: r.segredo,
    restantes: ate ? 0 : Math.max(0, MAX_TENTATIVAS - Number(r.tentativas)),
    ate,
  };
}

export async function zerarTentativas(orgId: string, ex: Exec = db): Promise<void> {
  await ex.execute(sql`
    UPDATE faturamento_acesso
       SET tentativas = 0, bloqueado_ate = NULL
     WHERE organizacao_id = ${orgId}::uuid
  `);
}

export type ResultadoSenha =
  | { ok: true; segredo: string }
  | { ok: false; motivo: 'sem-senha' }
  | { ok: false; motivo: 'bloqueado'; ate: Date }
  | { ok: false; motivo: 'errada'; restantes: number; ate: Date | null };

/** Confere a senha da aba contando a tentativa (acerto zera a contagem). */
export async function conferirSenha(
  orgId: string,
  senha: string,
  ex: Exec = db,
): Promise<ResultadoSenha> {
  const t = await registrarTentativa(orgId, ex);
  if (t.estado === 'sem-senha') return { ok: false, motivo: 'sem-senha' };
  if (t.estado === 'bloqueado') return { ok: false, motivo: 'bloqueado', ate: t.ate };
  if (senhaConfere(senha, t.senhaHash, t.senhaSalt)) {
    await zerarTentativas(orgId, ex);
    return { ok: true, segredo: t.segredo };
  }
  return { ok: false, motivo: 'errada', restantes: t.restantes, ate: t.ate };
}

/** Organizações em que o usuário tem alguma filial, e se é DONO em alguma delas. */
export async function organizacoesDoUsuario(
  userId: string,
): Promise<Array<{ id: string; nome: string; dono: boolean }>> {
  return (await db.execute(sql`
    SELECT o.id, o.nome, bool_or(uf.role = 'DONO') AS dono
      FROM usuario_filial uf
      JOIN filial f ON f.id = uf.filial_id
      JOIN organizacao o ON o.id = f.organizacao_id
     WHERE uf.usuario_id = ${userId}::uuid
     GROUP BY o.id, o.nome
     ORDER BY o.nome
  `)) as unknown as Array<{ id: string; nome: string; dono: boolean }>;
}

export async function organizacaoDaFilial(
  filialId: string,
): Promise<{ id: string; nome: string } | null> {
  const rows = (await db.execute(sql`
    SELECT o.id, o.nome
      FROM filial f
      JOIN organizacao o ON o.id = f.organizacao_id
     WHERE f.id = ${filialId}::uuid
  `)) as unknown as Array<{ id: string; nome: string }>;
  return rows[0] ?? null;
}
