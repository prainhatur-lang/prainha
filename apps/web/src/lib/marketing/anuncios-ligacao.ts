// Ligação de CADA casa com a conta de anúncios da Meta: a chave do usuário do
// sistema (Gerenciador de Negócios) e qual conta de anúncios (act_…) é a dela.
// Mora em filial_credencial (provedor 'meta_ads'), cifrado — sem migration.
// Gasto, saldo e resultado NÃO são gravados: a tela lê ao vivo da Meta.

import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { cifrar, decifrar, pista, segredoConfigurado } from '@/lib/segredo';

export const PROVEDOR_ADS = 'meta_ads';

export interface LigacaoAnuncios {
  accessToken: string;
  /** act_123… */
  contaId: string;
  /** nome da conta de anúncios */
  contaNome: string;
  /** quem é a chave (usuário do sistema) */
  usuario: string;
  /** Instagram que impulsiona (id da conta comercial) */
  igId: string;
  /** Página do Facebook ligada ao Instagram */
  paginaId: string;
}

const CHAVES: (keyof LigacaoAnuncios)[] = ['accessToken', 'contaId', 'contaNome', 'usuario', 'igId', 'paginaId'];

const vazia = (): LigacaoAnuncios => ({ accessToken: '', contaId: '', contaNome: '', usuario: '', igId: '', paginaId: '' });

export async function ligacoesAnuncios(filialIds: string[]): Promise<Map<string, LigacaoAnuncios>> {
  const out = new Map<string, LigacaoAnuncios>();
  if (filialIds.length === 0 || !segredoConfigurado()) return out;
  const linhas = await db
    .select({
      filialId: schema.filialCredencial.filialId,
      chave: schema.filialCredencial.chave,
      valor: schema.filialCredencial.valor,
    })
    .from(schema.filialCredencial)
    .where(and(inArray(schema.filialCredencial.filialId, filialIds), eq(schema.filialCredencial.provedor, PROVEDOR_ADS)));
  for (const l of linhas) {
    let valor = '';
    try {
      valor = decifrar(l.valor);
    } catch {
      continue;
    }
    const atual = out.get(l.filialId) ?? vazia();
    if ((CHAVES as string[]).includes(l.chave)) atual[l.chave as keyof LigacaoAnuncios] = valor;
    out.set(l.filialId, atual);
  }
  for (const [k, l] of out) if (!l.accessToken) out.delete(k);
  return out;
}

export async function ligacaoAnuncios(filialId: string): Promise<LigacaoAnuncios | null> {
  return (await ligacoesAnuncios([filialId])).get(filialId) ?? null;
}

export async function salvarLigacaoAnuncios(filialId: string, campos: Partial<LigacaoAnuncios>, userId: string | null) {
  for (const chave of CHAVES) {
    const valor = campos[chave];
    if (valor === undefined) continue;
    const linha = {
      valor: cifrar(valor),
      pista: chave === 'accessToken' ? pista(valor) : valor.slice(0, 40),
      atualizadoPor: userId,
    };
    await db
      .insert(schema.filialCredencial)
      .values({ filialId, provedor: PROVEDOR_ADS, chave, ...linha })
      .onConflictDoUpdate({
        target: [schema.filialCredencial.filialId, schema.filialCredencial.provedor, schema.filialCredencial.chave],
        set: { ...linha, atualizadoEm: new Date() },
      });
  }
}

export async function apagarLigacaoAnuncios(filialId: string) {
  await db
    .delete(schema.filialCredencial)
    .where(and(eq(schema.filialCredencial.filialId, filialId), eq(schema.filialCredencial.provedor, PROVEDOR_ADS)));
}

/** Uma chave já colada em OUTRA casa (o usuário do sistema costuma ser o mesmo das 3). */
export async function chaveDeOutraCasa(filialIds: string[], menos: string): Promise<string | null> {
  const m = await ligacoesAnuncios(filialIds.filter((f) => f !== menos));
  return [...m.values()][0]?.accessToken ?? null;
}

/** Centro da casa (cerca do ponto) pra mirar o público do impulsionamento. */
export const CENTRO_CASA: Record<string, { lat: number; lng: number }> = {
  '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9': { lat: -11.08983, lng: -37.14788 }, // 01 Prainha Bar
  'fde37b95-7c7e-4b41-a618-2aba1fbc0de7': { lat: -10.97509, lng: -37.03765 }, // 02 Tabuará
  'e899dae2-38bf-4f3f-9149-7effd059fab8': { lat: -11.01881, lng: -37.08429 }, // 03 Prainha Mar
};
