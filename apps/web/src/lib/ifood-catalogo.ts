// Módulo CATALOG (v2.0) do iFood: o cardápio de cada casa.
//
// O que interessa aqui não é montar cardápio pelo Concilia — isso continua no
// Portal do Parceiro, com foto e curadoria. O que o dia a dia precisa é:
//
//   1. pausar/voltar item quando acaba o insumo (hoje só dá pelo celular);
//   2. corrigir preço sem abrir outro sistema;
//   3. conferir o CÓDIGO DE PDV (externalCode) item a item.
//
// (3) é o que evita o estrago silencioso: o pedido do iFood entra no PDV
// casando `externalCode` com o produto do Consumer. Item sem código, ou com
// código que não existe na casa, chega na cozinha sem virar prato — e como o
// Consumer usa dois códigos que se sobrepõem (PRODUTOS x PRODUTODETALHE), o
// mesmo número pode apontar pro item errado. Ver `codigoPdv` da credencial.

import { ifoodApi, type CredIfood } from '@/lib/ifood-api';

const BASE = '/catalog/v2.0/merchants/';

export interface CatalogoIfood {
  catalogId: string;
  groupId: string;
  status: string;
  contexto: string[];
}

export interface ItemIfood {
  id: string;
  nome: string;
  categoria: string;
  categoriaId: string;
  /** Código de PDV. Vazio = pedido não casa com produto do Consumer. */
  externalCode: string;
  status: 'AVAILABLE' | 'UNAVAILABLE' | string;
  preco: number;
  precoOriginal: number;
  index: number;
}

export async function catalogosDaLoja(c: CredIfood, merchantId: string): Promise<CatalogoIfood[]> {
  const r = (await ifoodApi(c, BASE + encodeURIComponent(merchantId) + '/catalogs')) as Array<{
    catalogId?: string; groupId?: string; status?: string; context?: unknown;
  }>;
  if (!Array.isArray(r)) return [];
  return r.map((x) => ({
    catalogId: String(x.catalogId ?? ''),
    groupId: String(x.groupId ?? ''),
    status: String(x.status ?? ''),
    // `context` vem como lista de listas em alguns merchants; achata e vira texto.
    contexto: (Array.isArray(x.context) ? x.context.flat(2) : []).map(String),
  }));
}

/** O catálogo que o cliente vê no delivery. Uma loja pode ter mais de um
 *  (salão/retirada); mexer no errado muda o cardápio de outro canal. */
export function catalogoPrincipal(cats: CatalogoIfood[]): CatalogoIfood | null {
  if (cats.length === 0) return null;
  const pref = cats.find((x) => x.contexto.some((k) => /DEFAULT|DELIVERY/i.test(k)) && /AVAILABLE/i.test(x.status));
  return pref ?? cats.find((x) => /AVAILABLE/i.test(x.status)) ?? cats[0];
}

/** Categorias com itens, achatado em lista de itens. */
export async function itensDoCatalogo(
  c: CredIfood,
  merchantId: string,
  catalogId: string,
): Promise<ItemIfood[]> {
  const r = (await ifoodApi(
    c,
    BASE + encodeURIComponent(merchantId) + '/catalogs/' + encodeURIComponent(catalogId) + '/categories?includeItems=true',
  )) as Array<{
    id?: string; name?: string;
    items?: Array<{
      id?: string; name?: string; externalCode?: string; status?: string; index?: number;
      price?: { value?: number; originalValue?: number };
    }>;
  }>;
  const cats = Array.isArray(r) ? r : [];
  const itens: ItemIfood[] = [];
  for (const cat of cats) {
    for (const i of cat.items ?? []) {
      itens.push({
        id: String(i.id ?? ''),
        nome: String(i.name ?? ''),
        categoria: String(cat.name ?? ''),
        categoriaId: String(cat.id ?? ''),
        externalCode: String(i.externalCode ?? '').trim(),
        status: String(i.status ?? ''),
        preco: Number(i.price?.value ?? 0),
        precoOriginal: Number(i.price?.originalValue ?? i.price?.value ?? 0),
        index: Number(i.index ?? 0),
      });
    }
  }
  return itens;
}

/** Pausa ou volta UM item. PATCH por item é o caminho recomendado pelo iFood —
 *  os PATCH /items/status e /items/price viraram legado. */
export async function statusItem(
  c: CredIfood,
  merchantId: string,
  itemId: string,
  status: 'AVAILABLE' | 'UNAVAILABLE',
): Promise<void> {
  await ifoodApi(c, BASE + encodeURIComponent(merchantId) + '/items/' + encodeURIComponent(itemId), {
    metodo: 'PATCH',
    corpo: { status },
  });
}

/** Preço de UM item.
 *
 *  `originalValue` é o preço "de", riscado na tela do cliente. Mandar 0 apaga a
 *  promoção; mandar igual ao value é o estado normal — por isso o default é o
 *  próprio valor, e não 0: um PATCH de preço não deve inventar promoção nem
 *  apagar a que existe sem alguém ter pedido. */
export async function precoItem(
  c: CredIfood,
  merchantId: string,
  itemId: string,
  valor: number,
  valorOriginal?: number,
): Promise<void> {
  const v = Math.round(Number(valor) * 100) / 100;
  if (!(v > 0)) throw new Error('preço tem que ser maior que zero');
  await ifoodApi(c, BASE + encodeURIComponent(merchantId) + '/items/' + encodeURIComponent(itemId), {
    metodo: 'PATCH',
    corpo: { price: { value: v, originalValue: Math.round(Number(valorOriginal ?? v) * 100) / 100 } },
  });
}
