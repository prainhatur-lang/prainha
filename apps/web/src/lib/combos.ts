// COMBOS: produto de preço fixo cujas perguntas do wizard lançam produtos.
//
// Não há tabela própria: combo = tamanho (produto_variante) ligado em
// wizard_produto a perguntas cujas opções têm codigo_variante_externo (a opção
// LANÇA aquele produto como item filho; o preço extra é o PRECOPROMO). As três
// casas rodam banco próprio, então a nuvem é a fonte da verdade do wizard e a
// loja recebe tudo pelo /api/loja/catalogo-nuvem?tudo=1.
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export type ComboResumo = {
  varianteCodigo: number;
  nome: string;
  preco: number;
  etapas: number;
  opcoes: number;
  /** Marcado como combo (combo_marcado) — o resto é prato/bebida com escolhas. */
  marcado: boolean;
};

export type ComboOpcao = {
  codigo: number;
  nome: string;
  precoExtra: number;
  varianteCodigo: number | null;
};

export type ComboEtapa = {
  codigo: number;
  texto: string;
  min: number;
  max: number;
  /** Outros produtos que usam esta mesma pergunta (editar aqui não mexe neles). */
  outrosProdutos: string[];
  opcoes: ComboOpcao[];
};

export type ComboCompleto = {
  varianteCodigo: number;
  produtoId: string;
  /** Nome do produto (sem o tamanho) — é o que se edita. */
  nome: string;
  preco: number;
  etapas: ComboEtapa[];
};

export type ProdutoEscolha = { codigo: number; nome: string; preco: number };

/** Nome do tamanho: "Produto" ou "Produto (Tamanho)". */
const NOME_VARIANTE = sql.raw(
  `p.nome || COALESCE(' (' || NULLIF(t.descricao, '') || ')', '')`,
);

export async function listarCombos(filialId: string): Promise<ComboResumo[]> {
  const linhas = await db.execute<{
    codigo: number; nome: string; preco: string | null; etapas: number; opcoes: number; marcado: boolean;
  }>(sql`
    SELECT v.codigo_externo AS codigo, ${NOME_VARIANTE} AS nome, v.preco_venda::text AS preco,
           COUNT(DISTINCT wp.codigo_pergunta)::int AS etapas,
           COUNT(DISTINCT o.codigo_externo)::int AS opcoes,
           EXISTS (SELECT 1 FROM combo_marcado cm
                    WHERE cm.filial_id = wp.filial_id AND cm.codigo_variante_externo = v.codigo_externo) AS marcado
      FROM wizard_produto wp
      JOIN produto_variante v ON v.filial_id = wp.filial_id AND v.codigo_externo = wp.codigo_variante_externo
      JOIN produto p ON p.id = v.produto_id
      LEFT JOIN produto_tamanho t ON t.id = v.produto_tamanho_id
      JOIN wizard_opcao o ON o.filial_id = wp.filial_id AND o.codigo_pergunta = wp.codigo_pergunta
     WHERE wp.filial_id = ${filialId}
       AND v.data_delete IS NULL
     GROUP BY v.codigo_externo, p.nome, t.descricao, v.preco_venda
    HAVING COUNT(o.codigo_variante_externo) > 0
     ORDER BY 2`);
  return [...linhas].map((l) => ({
    varianteCodigo: Number(l.codigo),
    nome: l.nome,
    preco: Number(l.preco ?? 0),
    etapas: Number(l.etapas),
    opcoes: Number(l.opcoes),
    marcado: l.marcado === true,
  }));
}

/** Marca/desmarca um tamanho como combo da lista (combo_marcado). */
export async function marcarCombo(filialId: string, varianteCodigo: number, marcado: boolean, por: string | null) {
  if (marcado) {
    await db.execute(sql`
      INSERT INTO combo_marcado (filial_id, codigo_variante_externo, criado_por)
      VALUES (${filialId}, ${varianteCodigo}, ${por})
      ON CONFLICT DO NOTHING`);
  } else {
    await db.execute(sql`
      DELETE FROM combo_marcado WHERE filial_id = ${filialId} AND codigo_variante_externo = ${varianteCodigo}`);
  }
}

export async function carregarCombo(filialId: string, varianteCodigo: number): Promise<ComboCompleto | null> {
  const [v] = await db.execute<{ produto_id: string; nome: string; preco: string | null }>(sql`
    SELECT v.produto_id, p.nome, v.preco_venda::text AS preco
      FROM produto_variante v
      JOIN produto p ON p.id = v.produto_id
      LEFT JOIN produto_tamanho t ON t.id = v.produto_tamanho_id
     WHERE v.filial_id = ${filialId} AND v.codigo_externo = ${varianteCodigo}
     LIMIT 1`);
  if (!v) return null;

  const perguntas = await db.execute<{
    codigo: number; texto: string | null; min: number; max: number; outros: string[] | null;
  }>(sql`
    SELECT q.codigo_externo AS codigo, q.texto, q.respostas_min AS min, q.respostas_max AS max,
           (SELECT array_agg(DISTINCT p2.nome)
              FROM wizard_produto w2
              JOIN produto_variante v2 ON v2.filial_id = w2.filial_id AND v2.codigo_externo = w2.codigo_variante_externo
              JOIN produto p2 ON p2.id = v2.produto_id
             WHERE w2.filial_id = wp.filial_id AND w2.codigo_pergunta = wp.codigo_pergunta
               AND w2.codigo_variante_externo <> wp.codigo_variante_externo
               AND v2.data_delete IS NULL) AS outros
      FROM wizard_produto wp
      JOIN wizard_pergunta q ON q.filial_id = wp.filial_id AND q.codigo_externo = wp.codigo_pergunta
     WHERE wp.filial_id = ${filialId} AND wp.codigo_variante_externo = ${varianteCodigo}
     ORDER BY wp.ordem, q.codigo_externo`);

  const codigos = [...perguntas].map((p) => Number(p.codigo));
  const opcoes = codigos.length
    ? await db.execute<{ codigo: number; pergunta: number; nome: string | null; preco: string; variante: number | null }>(sql`
        SELECT codigo_externo AS codigo, codigo_pergunta AS pergunta, nome, preco_promo::text AS preco,
               codigo_variante_externo AS variante
          FROM wizard_opcao
         WHERE filial_id = ${filialId}
           AND codigo_pergunta IN (${sql.join(codigos.map((c) => sql`${c}`), sql`, `)})
         ORDER BY codigo_externo`)
    : [];

  return {
    varianteCodigo,
    produtoId: v.produto_id,
    nome: v.nome,
    preco: Number(v.preco ?? 0),
    etapas: [...perguntas].map((p) => ({
      codigo: Number(p.codigo),
      texto: p.texto ?? '',
      min: Number(p.min),
      max: Number(p.max),
      outrosProdutos: p.outros ?? [],
      opcoes: [...opcoes]
        .filter((o) => Number(o.pergunta) === Number(p.codigo))
        .map((o) => ({
          codigo: Number(o.codigo),
          nome: o.nome ?? '',
          precoExtra: Number(o.preco ?? 0),
          varianteCodigo: o.variante == null ? null : Number(o.variante),
        })),
    })),
  };
}

/** Tamanhos vendáveis da filial, pra escolher o que cada opção lança. */
export async function produtosParaEscolha(filialId: string): Promise<ProdutoEscolha[]> {
  const linhas = await db.execute<{ codigo: number; nome: string; preco: string | null }>(sql`
    SELECT v.codigo_externo AS codigo, ${NOME_VARIANTE} AS nome, v.preco_venda::text AS preco
      FROM produto_variante v
      JOIN produto p ON p.id = v.produto_id
      LEFT JOIN produto_tamanho t ON t.id = v.produto_tamanho_id
     WHERE v.filial_id = ${filialId}
       AND v.data_delete IS NULL
       AND COALESCE(p.descontinuado, false) = false
     ORDER BY 2`);
  return [...linhas].map((l) => ({ codigo: Number(l.codigo), nome: l.nome, preco: Number(l.preco ?? 0) }));
}
