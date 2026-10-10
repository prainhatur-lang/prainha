// Ligação de CADA casa com o Google (Perfil da Empresa): a chave de longa
// duração da conta Google e qual ficha é a da casa.
//
// Mora na mesma tabela da Cielo e do iFood (filial_credencial, provedor
// 'google'), então não precisou de migration: tudo entra cifrado (AES-256-GCM,
// @/lib/segredo). Aqui só fica a LIGAÇÃO — avaliação nenhuma é gravada (a
// política da API do Google não deixa; ver lib/google-avaliacoes.ts).

import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { cifrar, decifrar, pista, segredoConfigurado } from '@/lib/segredo';

export const PROVEDOR_GOOGLE = 'google';

export interface LigacaoGoogle {
  /** chave de longa duração da conta Google que administra as fichas */
  refreshToken: string;
  /** "accounts/123" — vazio enquanto a ficha não foi escolhida */
  conta: string;
  /** "locations/456" */
  local: string;
  /** nome da ficha no Google, pra pessoa conferir que é a casa certa */
  titulo: string;
}

const CHAVES_FICHA = ['conta', 'local', 'titulo'] as const;

/** Ligação de cada casa pedida, já decifrada. Casa sem linha não entra no mapa. */
export async function ligacoesGoogle(filialIds: string[]): Promise<Map<string, LigacaoGoogle>> {
  const out = new Map<string, LigacaoGoogle>();
  if (filialIds.length === 0 || !segredoConfigurado()) return out;
  const linhas = await db
    .select({
      filialId: schema.filialCredencial.filialId,
      chave: schema.filialCredencial.chave,
      valor: schema.filialCredencial.valor,
    })
    .from(schema.filialCredencial)
    .where(
      and(
        inArray(schema.filialCredencial.filialId, filialIds),
        eq(schema.filialCredencial.provedor, PROVEDOR_GOOGLE),
      ),
    );
  for (const l of linhas) {
    let valor = '';
    // CREDENCIAL_SECRET trocada deixa o valor ilegível: trata como "não ligado"
    try {
      valor = decifrar(l.valor);
    } catch {
      continue;
    }
    const atual = out.get(l.filialId) ?? { refreshToken: '', conta: '', local: '', titulo: '' };
    if (l.chave === 'refreshToken') atual.refreshToken = valor;
    else if (l.chave === 'conta') atual.conta = valor;
    else if (l.chave === 'local') atual.local = valor;
    else if (l.chave === 'titulo') atual.titulo = valor;
    out.set(l.filialId, atual);
  }
  for (const [id, l] of out) if (!l.refreshToken) out.delete(id);
  return out;
}

async function gravar(filialId: string, chave: string, valor: string, userId: string) {
  const linha = { valor: cifrar(valor), pista: pista(valor), atualizadoPor: userId };
  await db
    .insert(schema.filialCredencial)
    .values({ filialId, provedor: PROVEDOR_GOOGLE, chave, ...linha })
    .onConflictDoUpdate({
      target: [
        schema.filialCredencial.filialId,
        schema.filialCredencial.provedor,
        schema.filialCredencial.chave,
      ],
      set: { ...linha, atualizadoEm: new Date() },
    });
}

/** Guarda a chave de longa duração da conta Google nesta casa. */
export async function salvarChaveGoogle(filialId: string, refreshToken: string, userId: string) {
  await gravar(filialId, 'refreshToken', refreshToken, userId);
}

/** Diz qual ficha do Google é a desta casa. */
export async function salvarFichaGoogle(
  filialId: string,
  ficha: { conta: string; local: string; titulo: string },
  userId: string,
) {
  await gravar(filialId, 'conta', ficha.conta, userId);
  await gravar(filialId, 'local', ficha.local, userId);
  await gravar(filialId, 'titulo', ficha.titulo.slice(0, 200), userId);
}

/** Casa sem ficha do Google (ex.: filial de teste): tira só a escolha da ficha,
 *  a chave da conta continua. Só mexe em linha do provedor 'google'. */
export async function limparFichaGoogle(filialId: string) {
  await db
    .delete(schema.filialCredencial)
    .where(
      and(
        eq(schema.filialCredencial.filialId, filialId),
        eq(schema.filialCredencial.provedor, PROVEDOR_GOOGLE),
        inArray(schema.filialCredencial.chave, [...CHAVES_FICHA]),
      ),
    );
}
