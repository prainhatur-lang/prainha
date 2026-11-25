// Link de pagamento avulso por cartão — regras em um lugar só.
// (Tabela e o porquê: packages/db/src/schema/link-pagamento.ts)

import { randomBytes } from 'node:crypto';

/** Recusas seguidas que travam o link — barra quem usa o link pra testar cartão roubado. */
export const LINK_PG_MAX_TENTATIVAS = 6;
/** Validade padrão e opções da tela (horas). */
export const LINK_PG_VALIDADES_H = [24, 48, 72, 168] as const;
export const LINK_PG_VALIDADE_PADRAO_H = 48;

export function novoTokenLinkPagamento(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * ECI que prova a autenticação 3DS (e passa a responsabilidade da fraude pro
 * banco emissor): 05 (Visa/Elo/Amex) e 02 (Master) = portador autenticado;
 * 06 e 01 = o emissor respondeu pela autenticação (tentativa com prova).
 * 07/00/vazio = sem autenticação — este link NÃO aceita.
 */
export function eciAutenticado(eci: string | null | undefined): boolean {
  const e = String(eci ?? '').trim().padStart(2, '0');
  return e === '05' || e === '02' || e === '06' || e === '01';
}

export type SituacaoLink = 'aberto' | 'pago' | 'cancelado' | 'expirado' | 'travado' | 'processando' | 'verificar';

export function situacaoLinkPagamento(l: {
  status: string;
  expiraEm: Date;
  tentativas: number;
}): SituacaoLink {
  if (l.status === 'pago' || l.status === 'cancelado' || l.status === 'processando' || l.status === 'verificar')
    return l.status;
  if (l.expiraEm.getTime() <= Date.now()) return 'expirado';
  if (l.tentativas >= LINK_PG_MAX_TENTATIVAS) return 'travado';
  return 'aberto';
}

export const MSG_SEM_3DS =
  'Seu banco não autenticou este cartão (3-D Secure). Por segurança, este link só aceita cartão ' +
  'autenticado pelo banco. Confira se o cartão está liberado para compras online no aplicativo do ' +
  'banco ou tente outro cartão.';
