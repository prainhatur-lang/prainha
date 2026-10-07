// Lado "Next" da senha da aba Histórico de faturamento — cookie do passe e a
// guarda das rotas; hash, passe e banco estão em faturamento-acesso.ts.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { exigirPermApi } from './exigir-perm';
import {
  COOKIE_HF,
  VALIDADE_MS,
  assinarPasse,
  conferirPasse,
  lerAcesso,
  organizacoesDoUsuario,
} from './faturamento-acesso';

export const PERM_HISTORICO = 'faturamento_historico.read';

export interface SessaoAcesso {
  /** O dono já criou a senha? */
  temSenha: boolean;
  /** Até quando a aba fica aberta (ms) — null = trancada. */
  abertaAte: number | null;
  /** Trancada por tentativas erradas até quando. */
  bloqueadoAte: Date | null;
}

/** Lê o passe do cookie e confere contra o segredo atual da organização. */
export async function sessaoAcesso(orgId: string, userId: string): Promise<SessaoAcesso> {
  const acesso = await lerAcesso(orgId);
  if (!acesso) return { temSenha: false, abertaAte: null, bloqueadoAte: null };
  const passe = (await cookies()).get(COOKIE_HF)?.value;
  return {
    temSenha: true,
    abertaAte: conferirPasse(passe, acesso.segredo, orgId, userId),
    bloqueadoAte: acesso.bloqueadoAte,
  };
}

/** A aba está aberta pra este usuário nesta organização? (guarda das APIs de dado) */
export async function abaAberta(orgId: string, userId: string): Promise<boolean> {
  return (await sessaoAcesso(orgId, userId)).abertaAte !== null;
}

/** Entrega o passe (só em Route Handler — é onde o Next deixa gravar cookie). */
export async function gravarPasse(orgId: string, userId: string, segredo: string): Promise<number> {
  const exp = Date.now() + VALIDADE_MS;
  (await cookies()).set(COOKIE_HF, assinarPasse({ orgId, userId, exp }, segredo), {
    path: '/',
    maxAge: Math.floor(VALIDADE_MS / 1000),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return exp;
}

export async function apagarPasse(): Promise<void> {
  // Mesmos atributos de quem gravou — é o que faz o navegador apagar de fato.
  (await cookies()).set(COOKIE_HF, '', {
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

export interface OrgDaAba {
  id: string;
  nome: string;
  /** DONO em alguma filial da organização — só ele cria/troca a senha. */
  dono: boolean;
}

export type GuardaAba =
  | { user: User; org: OrgDaAba; error?: undefined }
  | { user?: undefined; org?: undefined; error: NextResponse };

/**
 * Guarda das rotas da aba: logado + permissão + organização do usuário e, com
 * `aberta`, o passe da senha valendo. Rota de dado SEMPRE chama com aberta=true.
 */
export async function guardaAba(organizacaoId: unknown, aberta: boolean): Promise<GuardaAba> {
  const g = await exigirPermApi(PERM_HISTORICO);
  if (g.error) return { error: g.error };
  const orgs = await organizacoesDoUsuario(g.user.id);
  const org =
    typeof organizacaoId === 'string' ? orgs.find((o) => o.id === organizacaoId) : undefined;
  if (!org) {
    return { error: NextResponse.json({ error: 'organização não encontrada' }, { status: 403 }) };
  }
  if (aberta && !(await abaAberta(org.id, g.user.id))) {
    return {
      error: NextResponse.json(
        { error: 'A aba está trancada. Digite a senha de novo.', trancada: true },
        { status: 423 },
      ),
    };
  }
  return { user: g.user, org: { id: org.id, nome: org.nome, dono: org.dono === true } };
}
