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

import { ifoodApi, IfoodErro, explicarErroIfood, type CredIfood } from '@/lib/ifood-api';

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

// ─── Editor do cardápio (homologação do módulo Catálogo) ────────────────────
//
// Tudo daqui pra baixo é ADITIVO: a tela antiga (pausar/preço/conferência de
// PDV) segue igual. O editor monta categoria e item do jeito que o iFood
// homologa: PUT /items com o item inteiro (produto + grupos de complemento +
// opções), preço/status por canal (contextModifiers), turnos de
// disponibilidade e operação em lote por produto (202 + batchId).

const m = (merchantId: string) => BASE + encodeURIComponent(merchantId);

export interface TurnoItem { startTime: string; endTime: string; monday: boolean; tuesday: boolean; wednesday: boolean; thursday: boolean; friday: boolean; saturday: boolean; sunday: boolean }

export interface ItemEditor {
  id: string;
  nome: string;
  descricao: string;
  externalCode: string;
  status: string;
  productId: string;
  preco: number;
  precoOriginal: number | null;
  index: number;
  turnos: TurnoItem[];
  contextos: Array<{ contexto: string; itemContextId: string }>;
  grupos: Array<{ id: string; nome: string; min: number; max: number; opcoes: number }>;
}

export interface CategoriaEditor {
  id: string;
  nome: string;
  externalCode: string;
  status: string;
  index: number;
  template: string;
  itens: ItemEditor[];
}

type Bruto = Record<string, unknown>;
const arr = (x: unknown): Bruto[] => (Array.isArray(x) ? (x as Bruto[]) : []);
const str = (x: unknown) => (x == null ? '' : String(x));

/** Categorias + itens do catálogo escolhido, com o que o editor precisa ver. */
export async function categoriasDoCatalogo(c: CredIfood, merchantId: string, catalogId: string): Promise<CategoriaEditor[]> {
  const r = await ifoodApi(c, m(merchantId) + '/catalogs/' + encodeURIComponent(catalogId) + '/categories?includeItems=true');
  return arr(r).map((cat) => ({
    id: str(cat.id),
    nome: str(cat.name),
    externalCode: str(cat.externalCode),
    status: str(cat.status),
    index: Number(cat.index ?? 0),
    template: str(cat.template),
    itens: arr(cat.items).map((i) => {
      const preco = (i.price ?? {}) as { value?: number; originalValue?: number };
      return {
        id: str(i.id),
        nome: str(i.name),
        descricao: str(i.description),
        externalCode: str(i.externalCode),
        status: str(i.status),
        productId: str(i.productId),
        preco: Number(preco.value ?? 0),
        precoOriginal: preco.originalValue == null ? null : Number(preco.originalValue),
        index: Number(i.index ?? 0),
        turnos: arr(i.shifts) as unknown as TurnoItem[],
        contextos: arr(i.contextModifiers).map((k) => ({ contexto: str(k.catalogContext), itemContextId: str(k.itemContextId) })),
        grupos: arr(i.optionGroups).map((g) => ({
          id: str(g.id), nome: str(g.name), min: Number(g.min ?? 0), max: Number(g.max ?? 0), opcoes: arr(g.options).length,
        })),
      };
    }),
  }));
}

export async function criarCategoria(
  c: CredIfood, merchantId: string, catalogId: string,
  d: { nome: string; externalCode?: string; status?: string; index?: number },
): Promise<{ id: string }> {
  const nome = d.nome.trim();
  if (!nome) throw new ErroValidacao('o nome da categoria é obrigatório');
  if (nome.length > 100) throw new ErroValidacao('nome da categoria com mais de 100 caracteres');
  const r = (await ifoodApi(c, m(merchantId) + '/catalogs/' + encodeURIComponent(catalogId) + '/categories', {
    metodo: 'POST',
    corpo: {
      name: nome,
      externalCode: d.externalCode?.trim() || undefined,
      status: d.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE',
      index: d.index ?? 0,
      template: 'DEFAULT',
    },
  })) as Bruto;
  return { id: str(r?.id) };
}

export async function editarCategoria(
  c: CredIfood, merchantId: string, catalogId: string, categoriaId: string,
  d: { nome?: string; status?: string; index?: number },
): Promise<void> {
  if (d.nome != null && (!d.nome.trim() || d.nome.trim().length > 100)) throw new ErroValidacao('nome da categoria entre 1 e 100 caracteres');
  await ifoodApi(c, m(merchantId) + '/catalogs/' + encodeURIComponent(catalogId) + '/categories/' + encodeURIComponent(categoriaId), {
    metodo: 'PATCH',
    corpo: {
      ...(d.nome != null ? { name: d.nome.trim() } : {}),
      ...(d.status ? { status: d.status } : {}),
      ...(d.index != null ? { index: d.index } : {}),
    },
  });
}

/** Erro de validação nosso (antes de chamar o iFood) — vira 400 na rota. */
export class ErroValidacao extends Error {}

export interface ItemNovo {
  /** Preenchidos = edição de item que já existe (o PUT /items é upsert). */
  itemId?: string;
  productId?: string;
  categoriaId: string;
  nome: string;
  descricao?: string;
  preco: number;
  precoOriginal?: number | null;
  codigoPdv: string;
  status?: 'AVAILABLE' | 'UNAVAILABLE';
  serve?: string;
  turno?: { inicio: string; fim: string; dias: boolean[] } | null;
  contextos?: Array<{ contexto: string; status: 'AVAILABLE' | 'UNAVAILABLE'; preco?: number | null }>;
  grupos?: Array<{ nome: string; min: number; max: number; opcoes: Array<{ nome: string; preco: number; codigoPdv?: string }> }>;
}

const SERVE = ['NOT_APPLICABLE', 'SERVES_1', 'SERVES_2', 'SERVES_3', 'SERVES_4'];
const DIAS_TURNO = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const reais = (n: number) => Math.round(Number(n) * 100) / 100;

/** Tudo que o iFood recusaria, dito em português ANTES de mandar. */
export function validarItemNovo(d: ItemNovo): string[] {
  const e: string[] = [];
  const nome = (d.nome ?? '').trim();
  if (!d.categoriaId) e.push('escolha a categoria');
  if (!nome) e.push('o título do item é obrigatório');
  if (nome.length > 100) e.push(`título com ${nome.length} caracteres (máximo 100)`);
  if ((d.descricao ?? '').length > 500) e.push(`descrição com ${(d.descricao ?? '').length} caracteres (máximo 500)`);
  if (!(Number(d.preco) > 0)) e.push('o preço tem que ser maior que zero');
  if (d.precoOriginal != null && d.precoOriginal !== 0 && !(Number(d.precoOriginal) > Number(d.preco))) {
    e.push('o preço "de" (promoção) tem que ser maior que o preço de venda');
  }
  if (!(d.codigoPdv ?? '').trim()) e.push('o código de PDV é obrigatório — sem ele o pedido não vira prato');
  if (d.status && d.status !== 'AVAILABLE' && d.status !== 'UNAVAILABLE') e.push('status tem que ser AVAILABLE ou UNAVAILABLE');
  if (d.turno) {
    const hh = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!hh.test(d.turno.inicio) || !hh.test(d.turno.fim)) e.push('turno: horário no formato HH:MM');
    else if (d.turno.fim <= d.turno.inicio) e.push('turno: o fim tem que ser depois do início');
    if (!d.turno.dias.some(Boolean)) e.push('turno: marque ao menos um dia');
  }
  for (const k of d.contextos ?? []) {
    if (!k.contexto) e.push('canal sem nome');
    if (k.preco != null && !(Number(k.preco) > 0)) e.push(`preço do canal ${k.contexto} tem que ser maior que zero`);
  }
  (d.grupos ?? []).forEach((g, n) => {
    const t = `complemento ${n + 1}${g.nome ? ` (${g.nome})` : ''}`;
    if (!g.nome?.trim()) e.push(`${t}: falta o nome`);
    if ((g.nome ?? '').length > 150) e.push(`${t}: nome com mais de 150 caracteres`);
    if (g.opcoes.length === 0) e.push(`${t}: sem nenhuma opção`);
    if (!(g.min >= 0) || !(g.max >= 1) || g.min > g.max) e.push(`${t}: mínimo/máximo inválido (mín ${g.min}, máx ${g.max})`);
    if (g.min > g.opcoes.length) e.push(`${t}: mínimo ${g.min} maior que o número de opções`);
    g.opcoes.forEach((o, i) => {
      if (!o.nome?.trim()) e.push(`${t}: opção ${i + 1} sem nome`);
      if (!(Number(o.preco) >= 0)) e.push(`${t}: opção ${i + 1} com preço negativo`);
    });
  });
  return e;
}

/** ItemNovo → FullItemDto (item + produtos + grupos + opções), com UUIDs novos. */
export function montarItemCompleto(d: ItemNovo) {
  const uuid = () => crypto.randomUUID();
  const productId = d.productId || uuid();
  const itemId = d.itemId || uuid();
  const products: Bruto[] = [];
  const optionGroups: Bruto[] = [];
  const options: Bruto[] = [];

  (d.grupos ?? []).forEach((g, gi) => {
    const grupoId = uuid();
    const ids: string[] = [];
    g.opcoes.forEach((o, oi) => {
      const pid = uuid();
      const oid = uuid();
      ids.push(oid);
      const cod = o.codigoPdv?.trim() || `${d.codigoPdv.trim()}-${gi + 1}-${oi + 1}`;
      products.push({ id: pid, name: o.nome.trim(), externalCode: cod, serving: 'NOT_APPLICABLE', industrialized: false });
      options.push({
        id: oid, status: 'AVAILABLE', index: oi, productId: pid,
        price: { value: reais(o.preco) }, fractions: [], externalCode: cod, contextModifiers: [],
      });
    });
    optionGroups.push({
      id: grupoId, name: g.nome.trim(), status: 'AVAILABLE', externalCode: `${d.codigoPdv.trim()}-G${gi + 1}`,
      index: gi, min: g.min, max: g.max, optionGroupType: 'DEFAULT', optionIds: ids,
    });
  });

  products.unshift({
    id: productId,
    name: d.nome.trim(),
    externalCode: d.codigoPdv.trim(),
    description: (d.descricao ?? '').trim(),
    serving: SERVE.includes(d.serve ?? '') ? d.serve : 'NOT_APPLICABLE',
    industrialized: false,
    optionGroups: optionGroups.map((g, i) => ({ id: g.id, min: g.min, max: g.max, index: i })),
  });

  const price: Bruto = { value: reais(d.preco) };
  if (d.precoOriginal && d.precoOriginal > d.preco) price.originalValue = reais(d.precoOriginal);

  const shifts = d.turno
    ? [Object.fromEntries([['startTime', d.turno.inicio], ['endTime', d.turno.fim], ...DIAS_TURNO.map((k, i) => [k, !!d.turno!.dias[i]])])]
    : [];

  const item = {
    id: itemId,
    type: 'DEFAULT',
    categoryId: d.categoriaId,
    status: d.status ?? 'AVAILABLE',
    price,
    externalCode: d.codigoPdv.trim(),
    index: 0,
    productId,
    shifts,
    tags: [],
    contextModifiers: (d.contextos ?? []).map((k) => ({
      catalogContext: k.contexto,
      status: k.status,
      ...(k.preco != null ? { price: { value: reais(k.preco) } } : {}),
      externalCode: d.codigoPdv.trim(),
    })),
  };
  return { item, products, optionGroups, options };
}

export async function salvarItemCompleto(c: CredIfood, merchantId: string, d: ItemNovo): Promise<{ itemId: string; productId: string }> {
  const erros = validarItemNovo(d);
  if (erros.length) throw new ErroValidacao(erros.join('; '));
  const corpo = montarItemCompleto(d);
  await ifoodApi(c, m(merchantId) + '/items', { metodo: 'PUT', corpo, timeoutMs: 30000 });
  return { itemId: corpo.item.id, productId: corpo.item.productId };
}

/** Item como o iFood guarda (GET /items/{id}/flat). Item que não existe = 404. */
export async function itemCompleto(c: CredIfood, merchantId: string, itemId: string): Promise<unknown> {
  return ifoodApi(c, m(merchantId) + '/items/' + encodeURIComponent(itemId) + '/flat');
}

/** Status de UM item com valor diferente por canal (statusByCatalog). */
export async function statusItemPorCanal(
  c: CredIfood, merchantId: string, itemId: string,
  status: 'AVAILABLE' | 'UNAVAILABLE', porCanal: Array<{ contexto: string; status: 'AVAILABLE' | 'UNAVAILABLE' }>,
): Promise<void> {
  await ifoodApi(c, m(merchantId) + '/items/status', {
    metodo: 'PATCH',
    corpo: { itemId, status, statusByCatalog: porCanal.map((k) => ({ status: k.status, catalogContext: k.contexto })) },
  });
}

/** Preço de UM item com valor diferente por canal (priceByCatalog). */
export async function precoItemPorCanal(
  c: CredIfood, merchantId: string, itemId: string,
  preco: number, porCanal: Array<{ contexto: string; preco: number }>,
): Promise<void> {
  if (!(preco > 0) || porCanal.some((k) => !(k.preco > 0))) throw new ErroValidacao('preço tem que ser maior que zero');
  await ifoodApi(c, m(merchantId) + '/items/price', {
    metodo: 'PATCH',
    corpo: { itemId, price: { value: reais(preco) }, priceByCatalog: porCanal.map((k) => ({ value: reais(k.preco), catalogContext: k.contexto })) },
  });
}

/** Item: status, preço e turnos num PATCH só (PATCH /items/{id}). */
export async function editarItem(
  c: CredIfood, merchantId: string, itemId: string,
  d: { status?: 'AVAILABLE' | 'UNAVAILABLE'; preco?: number; turno?: { inicio: string; fim: string; dias: boolean[] } | null },
): Promise<void> {
  const corpo: Bruto = {};
  if (d.status) corpo.status = d.status;
  if (d.preco != null) {
    if (!(d.preco > 0)) throw new ErroValidacao('preço tem que ser maior que zero');
    corpo.price = { value: reais(d.preco), originalValue: reais(d.preco) };
  }
  if (d.turno !== undefined) {
    corpo.shifts = d.turno
      ? [Object.fromEntries([['startTime', d.turno.inicio], ['endTime', d.turno.fim], ...DIAS_TURNO.map((k, i) => [k, !!d.turno!.dias[i]])])]
      : [];
  }
  await ifoodApi(c, m(merchantId) + '/items/' + encodeURIComponent(itemId), { metodo: 'PATCH', corpo });
}

/** Lote por PRODUTO (até centenas de uma vez): o iFood aceita com 202 e
 *  devolve um batchId pra acompanhar em GET /batch/{id}. */
async function lote(c: CredIfood, merchantId: string, recurso: 'status' | 'price', corpo: unknown[]): Promise<{ batchId: string }> {
  if (corpo.length === 0) throw new ErroValidacao('nenhum item selecionado');
  const r = (await ifoodApi(c, m(merchantId) + '/products/' + recurso, { metodo: 'PATCH', corpo, cru: true, timeoutMs: 30000 })) as Response;
  const txt = await r.text();
  if (!r.ok) {
    throw new IfoodErro('iFood PATCH /products/' + recurso + ' → ' + r.status + ': ' + txt.slice(0, 300), r.status, '', txt.slice(0, 2000));
  }
  let batchId = '';
  try { batchId = str((JSON.parse(txt) as Bruto).batchId); } catch { /* corpo vazio */ }
  return { batchId };
}

export function loteStatus(
  c: CredIfood, merchantId: string, catalogId: string,
  itens: Array<{ productId: string; status: 'AVAILABLE' | 'UNAVAILABLE' }>,
) {
  return lote(c, merchantId, 'status', itens.map((i) => ({ productId: i.productId, status: i.status, resources: ['ITEM'], catalogId })));
}

export function lotePreco(
  c: CredIfood, merchantId: string, catalogId: string,
  itens: Array<{ productId: string; preco: number }>,
) {
  if (itens.some((i) => !(i.preco > 0))) throw new ErroValidacao('todo preço do lote tem que ser maior que zero');
  return lote(c, merchantId, 'price', itens.map((i) => ({ productId: i.productId, price: { value: reais(i.preco) }, resources: ['ITEM'], catalogId })));
}

export async function resultadoLote(c: CredIfood, merchantId: string, batchId: string) {
  const r = (await ifoodApi(c, m(merchantId) + '/batch/' + encodeURIComponent(batchId))) as Bruto;
  return {
    status: str(r?.batchStatus),
    resultados: arr(r?.results).map((x) => ({ id: str(x.resourceId), resultado: str(x.result), motivo: str(x.failureReason) })),
  };
}

/** Erro do Catálogo em português: ErroValidacao vira 400 com o texto nosso;
 *  404 vira "item/categoria não existe" (não "confira o merchant_id"); e os
 *  `details` do ErrorResponseDto do iFood entram no recado, campo a campo. */
export function explicarErroCatalogo(e: unknown): { mensagem: string; status: number; semModulo: boolean; detalhes: string[] } {
  if (e instanceof ErroValidacao) return { mensagem: e.message, status: 400, semModulo: false, detalhes: [] };
  const base = explicarErroIfood(e, 'Catálogo');
  let detalhes: string[] = [];
  let conflito: string[] = [];
  if (e instanceof IfoodErro && e.corpo) {
    try {
      const j = JSON.parse(e.corpo) as Bruto;
      detalhes = arr(j.details).map((d) => [str(d.field), str(d.message) || str(d.code)].filter(Boolean).join(': '));
      conflito = arr(j.conflictingResources).map((x) => str(x.id ?? x.resourceId ?? x.externalCode ?? JSON.stringify(x)));
    } catch { /* corpo não-JSON */ }
  }
  const status = e instanceof IfoodErro ? e.status : 0;
  let mensagem = base.mensagem;
  if (status === 404) mensagem = 'o iFood não encontrou esse item/categoria/catálogo (NOT_FOUND) — pode ter sido apagado no Portal; recarregue a lista';
  if (status === 409) mensagem = 'conflito no iFood (CONFLICT): já existe um registro com esse código/nome' + (conflito.length ? ' — ' + conflito.join(', ') : '');
  if (status === 400 && detalhes.length) mensagem = 'o iFood recusou os dados (VALIDATION): ' + detalhes.join('; ');
  return { mensagem, status: base.status, semModulo: base.semModulo, detalhes };
}
