// Consulta de cardápio pra Nina: busca itens ATIVOS do cardápio público
// (produto_variante.menu_dino = true, sem delete/pausa, preço > 0) — a mesma
// base que alimenta o Menudino, sincronizada do Consumer pelo agente.
// Preço daqui é oficial e atual; a Nina pode citar.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

const LINK_CARDAPIO = 'https://prainha.menudino.com.br';

/** Minúsculas sem acento — espelha o translate() usado no SQL. */
function dobrar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export async function consultarCardapio(filialId: string, termo: string): Promise<string> {
  const palavras = dobrar(termo ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length >= 3)
    .slice(0, 4);
  if (palavras.length === 0) {
    return `Termo de busca vazio. Busque por uma palavra do prato (ex.: "moqueca", "camarão", "robalo"). Cardápio completo com fotos: ${LINK_CARDAPIO}`;
  }

  // Acha itens cujo nome+descrição contém TODAS as palavras (sem acento).
  const alvo = sql`translate(lower(coalesce(p.nome, '') || ' ' || coalesce(p.descricao, '')), 'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;
  const condicoes = palavras.map((w) => sql`${alvo} LIKE ${'%' + w + '%'}`);
  const where = condicoes.reduce((a, b) => sql`${a} AND ${b}`);

  const linhas = (await db.execute(sql`
    SELECT p.nome,
           COALESCE(t.descricao, t.sigla, '') AS tamanho,
           pv.preco_venda::float AS preco,
           LEFT(COALESCE(p.descricao, ''), 140) AS descr
    FROM produto_variante pv
    JOIN produto p ON p.id = pv.produto_id
    LEFT JOIN produto_tamanho t ON t.id = pv.produto_tamanho_id
    WHERE p.filial_id = ${filialId}
      AND pv.menu_dino
      AND pv.data_delete IS NULL
      AND pv.data_pausado IS NULL
      AND (p.descontinuado IS NOT TRUE)
      AND (p.data_pausado IS NULL)
      AND pv.preco_venda > 0
      AND ${where}
    ORDER BY p.nome, pv.preco_venda
    LIMIT 12
  `)) as unknown as Array<{ nome: string; tamanho: string; preco: number; descr: string }>;

  if (linhas.length === 0) {
    return `Nenhum item do cardápio bate com "${termo}". Tente outra palavra (ex.: "moqueca", "camarão", "picanha") — ou mande o cliente ver o cardápio completo com fotos: ${LINK_CARDAPIO}`;
  }

  const itens = linhas
    .map((l) => {
      const tam = l.tamanho ? ` (${l.tamanho})` : '';
      const preco = `R$ ${l.preco.toFixed(2).replace('.', ',')}`;
      const d = l.descr.trim() ? ` — ${l.descr.trim()}` : '';
      return `- ${l.nome.trim()}${tam}: ${preco}${d}`;
    })
    .join('\n');
  return `Itens do cardápio oficial (preço atual do sistema):\n${itens}\nCardápio completo com fotos: ${LINK_CARDAPIO}`;
}
