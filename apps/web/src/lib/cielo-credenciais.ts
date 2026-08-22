// De quem é a maquininha desta cobrança.
//
// Cada casa tem o próprio estabelecimento na Cielo — o dinheiro do delivery da
// Tabuará não pode cair na conta do Prainha. Até aqui as chaves eram env
// GLOBAL (CIELO_MERCHANT_ID etc) e serviam a filial toda.
//
// Ordem: credencial da filial (banco, cifrada) → env global. Filial sem nada
// cadastrado continua na env, então o Prainha não precisou migrar nada.

import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { decifrar, segredoConfigurado } from '@/lib/segredo';

export interface CredenciaisCielo {
  merchantId: string;
  merchantKey: string;
  mpiClientId: string;
  mpiClientSecret: string;
  establishmentCode: string;
  merchantName: string;
  mcc: string;
  /** De onde veio — aparece no diagnóstico, ajuda a achar "caiu na conta errada". */
  fonte: 'filial' | 'env';
}

/** As 7 chaves que a Cielo precisa, na ordem em que a tela pede. */
export const CHAVES_CIELO = [
  'merchantId',
  'merchantKey',
  'mpiClientId',
  'mpiClientSecret',
  'establishmentCode',
  'merchantName',
  'mcc',
] as const;
export type ChaveCielo = (typeof CHAVES_CIELO)[number];

/** Chaves que são SEGREDO (some da tela depois de salvar; as outras voltam
 *  em texto por serem identificação pública do estabelecimento). */
export const CHAVES_CIELO_SECRETAS: ChaveCielo[] = ['merchantKey', 'mpiClientSecret'];

function daEnv(): CredenciaisCielo {
  return {
    merchantId: process.env.CIELO_MERCHANT_ID || '',
    merchantKey: process.env.CIELO_MERCHANT_KEY || '',
    mpiClientId: process.env.CIELO_3DS_CLIENT_ID || '',
    mpiClientSecret: process.env.CIELO_3DS_CLIENT_SECRET || '',
    establishmentCode: process.env.CIELO_3DS_ESTABLISHMENT_CODE || process.env.CIELO_MERCHANT_ID || '',
    merchantName: process.env.CIELO_3DS_MERCHANT_NAME || 'Prainha',
    mcc: process.env.CIELO_3DS_MCC || '5812',
    fonte: 'env',
  };
}

/**
 * Credenciais pra cobrar por esta filial.
 *
 * `filialId` ausente = env global (rotas antigas que ainda não passam a
 * filial). Filial COM cadastro usa o dela e não mistura com a env: metade de
 * uma conta e metade de outra é o jeito mais rápido de a cobrança cair no
 * lugar errado. Só `merchantName` e `mcc`, que são rótulo, caem no default.
 */
export async function credenciaisCielo(filialId?: string | null): Promise<CredenciaisCielo> {
  if (!filialId || !segredoConfigurado()) return daEnv();

  const linhas = await db
    .select({ chave: schema.filialCredencial.chave, valor: schema.filialCredencial.valor })
    .from(schema.filialCredencial)
    .where(and(
      eq(schema.filialCredencial.filialId, filialId),
      eq(schema.filialCredencial.provedor, 'cielo'),
    ));
  if (linhas.length === 0) return daEnv();

  const m = new Map<string, string>();
  for (const l of linhas) {
    try {
      m.set(l.chave, decifrar(l.valor));
    } catch {
      // Segredo que não abre (CREDENCIAL_SECRET trocada) não pode virar
      // string vazia silenciosa — melhor a cobrança falhar com credencial
      // faltando do que tentar cobrar com chave pela metade.
    }
  }
  // Sem o par principal não dá pra cobrar; cair na env aqui cobraria na conta
  // da outra casa, então é melhor devolver vazio e a rota reclamar.
  const merchantId = m.get('merchantId') ?? '';
  const merchantKey = m.get('merchantKey') ?? '';

  return {
    merchantId,
    merchantKey,
    mpiClientId: m.get('mpiClientId') ?? '',
    mpiClientSecret: m.get('mpiClientSecret') ?? '',
    establishmentCode: m.get('establishmentCode') || merchantId,
    merchantName: m.get('merchantName') || 'Prainha',
    mcc: m.get('mcc') || '5812',
    fonte: 'filial',
  };
}

/** Diagnóstico sem revelar segredo — pra tela dizer o que falta. */
export function faltandoPraCobrar(c: CredenciaisCielo): ChaveCielo[] {
  const falta: ChaveCielo[] = [];
  if (!c.merchantId) falta.push('merchantId');
  if (!c.merchantKey) falta.push('merchantKey');
  return falta;
}

/** 3DS precisa do par do MPI além do par da loja. */
export function faltandoPra3ds(c: CredenciaisCielo): ChaveCielo[] {
  const falta = faltandoPraCobrar(c);
  if (!c.mpiClientId) falta.push('mpiClientId');
  if (!c.mpiClientSecret) falta.push('mpiClientSecret');
  return falta;
}
