// Consulta de cardápio pra Nina: busca itens ATIVOS do cardápio público
// (produto_variante.menu_dino = true, sem delete/pausa, preço > 0) — a mesma
// base que alimenta o Menudino, sincronizada do Consumer pelo agente.
// Preço daqui é oficial e atual; a Nina pode citar.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

const LINK_CARDAPIO = 'https://prainha.menudino.com.br';

export interface ItemCardapio {
  nome: string;
  tamanho: string;
  preco: number;
  preco_delivery: number | null;
  preco_ifood: number | null;
  /** false = vendido na casa mas não aparece no Menudino. */
  no_cardapio_online?: boolean;
  /** true = PAUSADO no PDV (em falta hoje) — informar, nunca oferecer. */
  pausado?: boolean;
  descr: string;
}

/** Minúsculas sem acento — espelha o translate() usado no SQL. */
function dobrar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// POPULARIDADE REAL (25/08): o prompt promete "os primeiros estão ordenados
// por popularidade" mas a query ordenava por NOME — "quais drinks?" devolvia
// Blonde Citrus primeiro por começar com B. A agregação de vendas (60 dias)
// custa ~2s, então fica em cache por instância (6h) e o ranking é feito em JS.
const VENDAS_TTL_MS = 6 * 3600 * 1000;
const vendasCache = new Map<string, { em: number; qtd: Map<string, number> }>();

async function vendasPorProduto(filialId: string): Promise<Map<string, number>> {
  const hit = vendasCache.get(filialId);
  if (hit && Date.now() - hit.em < VENDAS_TTL_MS) return hit.qtd;
  const rows = (await db.execute(sql`
    SELECT pi.produto_id AS id, sum(pi.quantidade)::float AS qtd
    FROM pedido_item pi
    JOIN pedido pe ON pe.id = pi.pedido_id
    WHERE pi.filial_id = ${filialId}
      AND pi.produto_id IS NOT NULL
      AND pe.data_abertura > now() - interval '60 days'
    GROUP BY pi.produto_id
  `)) as unknown as Array<{ id: string; qtd: number }>;
  const qtd = new Map(rows.map((r) => [r.id, r.qtd]));
  vendasCache.set(filialId, { em: Date.now(), qtd });
  return qtd;
}

/** Busca crua no cardápio ativo. termo vazio = lista tudo (até o limite).
 *  Usada pela consulta da conversa e pelo orçamento de evento. */
export async function buscarItensCardapio(
  filialId: string,
  termo: string,
  limite = 12,
): Promise<ItemCardapio[]> {
  const palavras = dobrar(termo ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length >= 3)
    .slice(0, 4);

  // Acha itens cujo nome+descrição contém TODAS as palavras (sem acento).
  const alvo = sql`translate(lower(coalesce(p.nome, '') || ' ' || coalesce(p.descricao, '')), 'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;
  const where =
    palavras.length === 0
      ? sql`TRUE`
      : palavras.map((w) => sql`${alvo} LIKE ${'%' + w + '%'}`).reduce((a, b) => sql`${a} AND ${b}`);

  // Preços por canal: salão = produto_variante; delivery próprio e iFood =
  // delivery_item (quando o cardápio do delivery estiver preenchido). Itens
  // sem delivery_item mostram só o preço de salão.
  // Filtro de canal: menu_dino é só o cardápio ONLINE (305 itens); a casa
  // vende ~990 (comanda do garçom / balcão / cardápio digital) — ex.: Peixe
  // Inteiro frito, bebidas por dose, sobremesas. A Nina enxerga TUDO que é
  // vendável; o campo no_cardapio_online diferencia na resposta.
  // Busca MAIS que o limite pra dar espaço ao re-ranking por vendas (numa
  // lista grande — orçamento lista tudo — o over-fetch não faz sentido).
  const buscar = limite <= 20 ? limite * 6 : limite;
  const linhas = (await db.execute(sql`
    SELECT p.id AS produto_id,
           p.nome,
           COALESCE(t.descricao, t.sigla, '') AS tamanho,
           pv.preco_venda::float AS preco,
           di.preco::float AS preco_delivery,
           di.preco_ifood::float AS preco_ifood,
           pv.menu_dino AS no_cardapio_online,
           (pv.data_pausado IS NOT NULL OR p.data_pausado IS NOT NULL) AS pausado,
           LEFT(COALESCE(p.descricao, ''), 140) AS descr
    FROM produto_variante pv
    JOIN produto p ON p.id = pv.produto_id
    LEFT JOIN produto_tamanho t ON t.id = pv.produto_tamanho_id
    LEFT JOIN delivery_item di
      ON di.variante_id = pv.id AND di.filial_id = p.filial_id AND di.ativo
    WHERE p.filial_id = ${filialId}
      AND (pv.menu_dino OR pv.comanda_mobile OR pv.desktop OR pv.cardapio_digital)
      AND pv.data_delete IS NULL
      AND (p.descontinuado IS NOT TRUE)
      AND pv.preco_venda > 0
      AND ${where}
    ORDER BY (pv.data_pausado IS NOT NULL OR p.data_pausado IS NOT NULL) ASC, pv.menu_dino DESC, p.nome, pv.preco_venda
    LIMIT ${buscar}
  `)) as unknown as Array<ItemCardapio & { produto_id: string }>;

  // Re-ranking por VENDAS reais (60 dias): ativo antes de pausado, mais
  // vendido primeiro, empate mantém a ordem estável da query. Falha na
  // agregação não derruba a consulta — segue a ordem original.
  try {
    const vendas = await vendasPorProduto(filialId);
    linhas.sort((a, b) => {
      if (!!a.pausado !== !!b.pausado) return a.pausado ? 1 : -1;
      return (vendas.get(b.produto_id) ?? 0) - (vendas.get(a.produto_id) ?? 0);
    });
  } catch (e) {
    console.error('[cardapio] ranking por vendas falhou:', e instanceof Error ? e.message : e);
  }
  return linhas.slice(0, limite);
}

export async function consultarCardapio(filialId: string, termo: string): Promise<string> {
  const temTermo = dobrar(termo ?? '').replace(/[^a-z0-9\s]/g, '').trim().length >= 3;
  if (!temTermo) {
    return `Termo de busca vazio. Busque por uma palavra do prato (ex.: "moqueca", "camarão", "robalo"). Cardápio completo com fotos: ${LINK_CARDAPIO}`;
  }

  const linhas = await buscarItensCardapio(filialId, termo, 12);
  if (linhas.length === 0) {
    return `Nenhum item do cardápio bate com "${termo}". Tente outra palavra (ex.: "moqueca", "camarão", "picanha") — ou mande o cliente ver o cardápio completo com fotos: ${LINK_CARDAPIO}`;
  }

  const rs = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
  let temMultiCanal = false;
  const itens = linhas
    .map((l) => {
      const tam = l.tamanho ? ` (${l.tamanho})` : '';
      const canais: string[] = [];
      if (l.preco_delivery && l.preco_delivery > 0) canais.push(`delivery ${rs(l.preco_delivery)}`);
      if (l.preco_ifood && l.preco_ifood > 0) canais.push(`iFood ${rs(l.preco_ifood)}`);
      const preco = canais.length > 0 ? `no restaurante ${rs(l.preco)} · ${canais.join(' · ')}` : rs(l.preco);
      if (canais.length > 0) temMultiCanal = true;
      const d = l.descr.trim() ? ` — ${l.descr.trim()}` : '';
      const fora = l.no_cardapio_online === false ? ' [servido na casa; não aparece no cardápio online]' : '';
      const pausa = l.pausado ? ' ⛔ [PAUSADO no PDV — EM FALTA HOJE: não ofereça; avise que está temporariamente indisponível e sugira um parecido]' : '';
      return `- ${l.nome.trim()}${tam}: ${preco}${d}${fora}${pausa}`;
    })
    .join('\n');
  const avisoCanal = temMultiCanal
    ? '\nATENÇÃO: item com preço por canal — se o cliente ainda não disse se é pra consumir no restaurante, pedir entrega ou pelo iFood, PERGUNTE antes e cite só o preço do canal dele.'
    : '';
  return `Itens do cardápio oficial (preço atual do sistema):\n${itens}${avisoCanal}\nCardápio completo com fotos: ${LINK_CARDAPIO}`;
}
