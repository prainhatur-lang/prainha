// Credenciais do e.Rede (Rede/Itaú — cobrança ONLINE) por filial.
//
// Mesmo desenho de @/lib/cielo-credenciais: cada casa tem o próprio PV na
// Rede; as chaves vivem cifradas em filial_credencial (provedor 'rede') e, sem
// cadastro, caem na env (REDE_PV / REDE_CHAVE_INTEGRACAO).
//
// PV = número de filiação (vira clientId no OAuth); Chave de Integração é
// gerada pelo usuário master no Portal Use Rede (e-commerce > chave de
// integração) e vira clientSecret.
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { decifrar, segredoConfigurado } from '@/lib/segredo';

export interface CredenciaisRede {
  pv: string;
  chaveIntegracao: string;
  /** Texto na fatura do cliente (até 18 caracteres). */
  softDescriptor: string;
  fonte: 'filial' | 'env';
}

/** As chaves da Rede, na ordem em que a tela pede. */
export const CHAVES_REDE = ['pv', 'chaveIntegracao', 'softDescriptor'] as const;
export type ChaveRede = (typeof CHAVES_REDE)[number];
export const CHAVES_REDE_SECRETAS: ChaveRede[] = ['chaveIntegracao'];

function daEnv(): CredenciaisRede {
  return {
    pv: process.env.REDE_PV || '',
    chaveIntegracao: process.env.REDE_CHAVE_INTEGRACAO || '',
    softDescriptor: process.env.REDE_SOFT_DESCRIPTOR || 'PRAINHA',
    fonte: 'env',
  };
}

export async function credenciaisRede(filialId?: string | null): Promise<CredenciaisRede> {
  if (!filialId || !segredoConfigurado()) return daEnv();
  const linhas = await db
    .select({ chave: schema.filialCredencial.chave, valor: schema.filialCredencial.valor })
    .from(schema.filialCredencial)
    .where(and(
      eq(schema.filialCredencial.filialId, filialId),
      eq(schema.filialCredencial.provedor, 'rede'),
    ));
  if (linhas.length === 0) return daEnv();
  const m = new Map<string, string>();
  for (const l of linhas) {
    try { m.set(l.chave, decifrar(l.valor)); } catch { /* segredo que não abre não vira string vazia */ }
  }
  return {
    pv: m.get('pv') ?? '',
    chaveIntegracao: m.get('chaveIntegracao') ?? '',
    softDescriptor: m.get('softDescriptor') || 'PRAINHA',
    fonte: 'filial',
  };
}
