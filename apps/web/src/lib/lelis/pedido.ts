// Pedido SEM NOTA da Lelis pras casas (06/11/2026). Pedido do dono: mandar
// caixas pro Bar, Mar e Tabuará sem emitir nota por enquanto, com o controle do
// dinheiro — a Lelis (Alex) recebe das casas pra pagar os fornecedores.
//
// Um pedido faz, numa transação só:
//  - baixa o estoque da Lelis (revenda_movimento SAIDA_PEDIDO);
//  - lança o a receber da Lelis (revenda_receber, comprador = a casa);
//  - lança a conta a pagar NA CASA (origem LELIS, fornecedor Lelis);
//  - NÃO mexe no estoque da casa: a casa confere o que chegou e dá entrada
//    (receberPedidoLelis, tela /movimento/lelis/[id]/receber).
// Cancelar devolve o estoque, cancela o a receber e apaga a conta da casa
// (só se a casa ainda não pagou).

import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { dateToBrYmd } from '@/lib/datas';
import { aplicarMpmEntrada, desfazerMpmEntrada } from '@/lib/custo-medio';

export class RecusaPedido extends Error {}

const LELIS_CNPJ = '54228128000136';
/** As casas que compram da Lelis. */
export const CASAS_PEDIDO: Record<string, string> = {
  '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9': 'Prainha Bar',
  'fde37b95-7c7e-4b41-a618-2aba1fbc0de7': 'Tabuará',
  'e899dae2-38bf-4f3f-9149-7effd059fab8': 'Prainha Mar',
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const linhas = <T>(r: unknown) => r as unknown as T[];
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Fornecedor Lelis na casa: pelo CNPJ, senão pelo nome; não tendo, cadastra. */
async function fornecedorLelisNaCasa(tx: Tx, casaId: string): Promise<string> {
  const [achado] = linhas<{ id: string }>(
    await tx.execute(sql`
      SELECT id FROM fornecedor
       WHERE filial_id = ${casaId}::uuid AND data_delete IS NULL
         AND (cnpj_ou_cpf = ${LELIS_CNPJ} OR nome ILIKE 'lelis%' OR razao_social ILIKE 'lelis%')
       ORDER BY (cnpj_ou_cpf = ${LELIS_CNPJ}) DESC NULLS LAST
       LIMIT 1`),
  );
  if (achado) return achado.id;
  const [novo] = linhas<{ id: string }>(
    await tx.execute(sql`
      INSERT INTO fornecedor (filial_id, cnpj_ou_cpf, nome, razao_social, rg_ou_ie, endereco, numero, bairro, cidade, uf, cep)
      VALUES (${casaId}::uuid, ${LELIS_CNPJ}, 'Lelis Distribuidora',
              'LELIS ATACADISTA E VAREJISTA DE ALIMENTOS E BEBIDAS LTDA', '272093238',
              'RUA TENENTE ARAGAO', '630', 'FAROLANDIA', 'ARACAJU', 'SE', '49032060')
      RETURNING id`),
  );
  if (!novo) throw new Error('falha ao cadastrar a Lelis como fornecedor');
  return novo.id;
}

export interface ItemPedido {
  produtoId: string;
  quantidade: number;
  precoUnit: number;
}

export async function criarPedidoLelis(opts: {
  lelisId: string;
  destinoId: string;
  vencimento: string;
  observacao?: string | null;
  itens: ItemPedido[];
  userId: string;
  email: string;
}): Promise<{ id: string; numero: number; total: number }> {
  const casa = CASAS_PEDIDO[opts.destinoId];
  if (!casa) throw new RecusaPedido('casa de destino inválida');
  const itens = opts.itens.filter((i) => i.quantidade > 0);
  if (!itens.length) throw new RecusaPedido('nenhum item com quantidade');
  if (itens.some((i) => !(i.precoUnit > 0))) throw new RecusaPedido('item sem preço');

  return db.transaction(async (tx) => {
    const ids = itens.map((i) => i.produtoId);
    const prods = linhas<{ id: string; descricao: string; custo: number; saldo: number }>(
      await tx.execute(sql`
        SELECT p.id, p.descricao, p.custo_unit::float AS custo,
               coalesce((SELECT sum(m.quantidade) FROM revenda_movimento m WHERE m.revenda_produto_id = p.id), 0)::float AS saldo
          FROM revenda_produto p
         WHERE p.filial_id = ${opts.lelisId}::uuid AND p.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
         FOR UPDATE OF p`),
    );
    const porId = new Map(prods.map((p) => [p.id, p]));
    for (const it of itens) {
      const p = porId.get(it.produtoId);
      if (!p) throw new RecusaPedido('produto não é da Lelis');
      if (p.saldo < it.quantidade - 1e-9) {
        throw new RecusaPedido(`${p.descricao}: só tem ${p.saldo} no estoque, pedido de ${it.quantidade}`);
      }
    }
    const total = r2(itens.reduce((s, i) => s + r2(i.quantidade * i.precoUnit), 0));

    const [ped] = linhas<{ id: string; numero: number }>(
      await tx.execute(sql`
        INSERT INTO revenda_pedido (filial_id, destino_filial_id, total, vencimento, observacao, criado_por)
        VALUES (${opts.lelisId}::uuid, ${opts.destinoId}::uuid, ${total.toFixed(2)}::numeric,
                ${opts.vencimento}::date, ${opts.observacao ?? null}, ${opts.email})
        RETURNING id, numero`),
    );
    if (!ped) throw new Error('falha ao gravar o pedido');
    const rotulo = `Pedido Lelis nº ${ped.numero} (sem nota)`;

    for (const it of itens) {
      const p = porId.get(it.produtoId)!;
      await tx.execute(sql`
        INSERT INTO revenda_pedido_item (pedido_id, revenda_produto_id, descricao, quantidade, preco_unit, custo_unit, total)
        VALUES (${ped.id}::uuid, ${p.id}::uuid, ${p.descricao}, ${String(it.quantidade)}::numeric,
                ${it.precoUnit.toFixed(4)}::numeric, ${p.custo.toFixed(4)}::numeric,
                ${r2(it.quantidade * it.precoUnit).toFixed(2)}::numeric)`);
      await tx.execute(sql`
        INSERT INTO revenda_movimento (filial_id, revenda_produto_id, tipo, quantidade, custo_unit, revenda_pedido_id, observacao, criado_por)
        VALUES (${opts.lelisId}::uuid, ${p.id}::uuid, 'SAIDA_PEDIDO', ${String(-it.quantidade)}::numeric,
                ${p.custo.toFixed(4)}::numeric, ${ped.id}::uuid, ${`${rotulo} — ${casa}`}, ${opts.email})`);
    }

    const [cnpjCasa] = linhas<{ cnpj: string | null }>(
      await tx.execute(sql`SELECT cnpj FROM filial WHERE id = ${opts.destinoId}::uuid`),
    );
    await tx.execute(sql`
      INSERT INTO revenda_receber (filial_id, revenda_pedido_id, comprador_doc, comprador_nome, descricao, parcela, total_parcelas,
                                   vencimento, valor, forma_pagamento, criado_por)
      VALUES (${opts.lelisId}::uuid, ${ped.id}::uuid, ${cnpjCasa?.cnpj ?? null}, ${casa}, ${rotulo}, 1, 1,
              ${opts.vencimento}::date, ${total.toFixed(2)}::numeric, '18', ${opts.email})`);

    const fornecedorId = await fornecedorLelisNaCasa(tx, opts.destinoId);
    const [conta] = linhas<{ id: string }>(
      await tx.execute(sql`
        INSERT INTO conta_pagar (filial_id, fornecedor_id, parcela, total_parcelas, data_vencimento, valor, competencia,
                                 descricao, observacao, origem, criado_por, criado_em, data_cadastro)
        VALUES (${opts.destinoId}::uuid, ${fornecedorId}::uuid, 1, 1, ${opts.vencimento}::date, ${total.toFixed(2)}::numeric,
                ${opts.vencimento.slice(0, 7)}, ${rotulo},
                ${`Mercadoria da Lelis Distribuidora sem nota fiscal (a nota sai depois). ${itens.length} item(ns).${opts.observacao ? ` ${opts.observacao}` : ''}`},
                'LELIS', ${opts.userId}::uuid, now(), now())
        RETURNING id`),
    );
    await tx.execute(sql`UPDATE revenda_pedido SET conta_pagar_id = ${conta?.id ?? null}::uuid WHERE id = ${ped.id}::uuid`);
    return { id: ped.id, numero: ped.numero, total };
  });
}

export async function cancelarPedidoLelis(opts: { lelisId: string; pedidoId: string; email: string; userId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [ped] = linhas<{ id: string; numero: number; status: string; conta_pagar_id: string | null }>(
      await tx.execute(sql`
        SELECT id, numero, status, conta_pagar_id FROM revenda_pedido
         WHERE id = ${opts.pedidoId}::uuid AND filial_id = ${opts.lelisId}::uuid FOR UPDATE`),
    );
    if (!ped) throw new RecusaPedido('pedido não encontrado');
    if (ped.status === 'CANCELADO') return;
    if (ped.conta_pagar_id) {
      const [c] = linhas<{ pago: boolean }>(
        await tx.execute(sql`
          SELECT (c.data_pagamento IS NOT NULL OR EXISTS (SELECT 1 FROM conta_pagar_baixa b WHERE b.conta_pagar_id = c.id)) AS pago
            FROM conta_pagar c WHERE c.id = ${ped.conta_pagar_id}::uuid`),
      );
      if (c?.pago) throw new RecusaPedido('a casa já pagou esse pedido — estorne o pagamento antes');
    }
    const [rec] = linhas<{ recebido: boolean }>(
      await tx.execute(sql`
        SELECT bool_or(recebido_em IS NOT NULL) AS recebido FROM revenda_receber WHERE revenda_pedido_id = ${ped.id}::uuid`),
    );
    if (rec?.recebido) throw new RecusaPedido('a Lelis já deu o pedido como recebido — desfaça o recebimento antes');

    await tx.execute(sql`
      INSERT INTO revenda_movimento (filial_id, revenda_produto_id, tipo, quantidade, custo_unit, revenda_pedido_id, observacao, criado_por)
      SELECT filial_id, revenda_produto_id, 'ESTORNO_PEDIDO', -sum(quantidade), max(custo_unit), revenda_pedido_id,
             'Cancelamento: Pedido Lelis nº ' || ${ped.numero} || ' (sem nota)', ${opts.email}
        FROM revenda_movimento
       WHERE revenda_pedido_id = ${ped.id}::uuid AND tipo IN ('SAIDA_PEDIDO', 'ESTORNO_PEDIDO')
       GROUP BY filial_id, revenda_produto_id, revenda_pedido_id
      HAVING sum(quantidade) <> 0`);
    // (falta da conferência já voltou como ESTORNO_PEDIDO: soma tudo pra não devolver em dobro)
    // Tira da casa o que entrou no estoque dela (mesmo custo da entrada).
    const entradas = linhas<{ id: string; produto_casa_id: string; quantidade: number; preco_unit: number; descricao: string; destino: string }>(
      await tx.execute(sql`
        SELECT i.id, i.produto_casa_id, coalesce(i.quantidade_recebida, i.quantidade)::float AS quantidade, i.preco_unit::float AS preco_unit, i.descricao,
               p.destino_filial_id AS destino
          FROM revenda_pedido_item i JOIN revenda_pedido p ON p.id = i.pedido_id
         WHERE i.pedido_id = ${ped.id}::uuid AND i.movimento_casa_id IS NOT NULL AND i.produto_casa_id IS NOT NULL`),
    );
    for (const e of entradas) {
      await tx.insert(schema.movimentoEstoque).values({
        filialId: e.destino,
        produtoId: e.produto_casa_id,
        tipo: 'SAIDA_DEVOLUCAO',
        quantidade: (-e.quantidade).toFixed(4),
        precoUnitario: e.preco_unit.toFixed(6),
        valorTotal: r2(-e.quantidade * e.preco_unit).toFixed(2),
        dataHora: new Date(),
        observacao: `Cancelado: Pedido Lelis nº ${ped.numero} (sem nota) — ${e.descricao}`,
        criadoPor: opts.userId,
      });
      await desfazerMpmEntrada({ produtoId: e.produto_casa_id, qtdEntrada: e.quantidade, custoEntrada: e.preco_unit, exec: tx });
      await tx.execute(sql`UPDATE revenda_pedido_item SET movimento_casa_id = NULL WHERE id = ${e.id}::uuid`);
    }
    await tx.execute(sql`UPDATE revenda_receber SET cancelado = true WHERE revenda_pedido_id = ${ped.id}::uuid`);
    if (ped.conta_pagar_id) {
      await tx.execute(sql`UPDATE conta_pagar SET data_delete = now() WHERE id = ${ped.conta_pagar_id}::uuid AND data_delete IS NULL`);
    }
    await tx.execute(sql`
      UPDATE revenda_pedido SET status = 'CANCELADO', cancelado_em = now(), cancelado_por = ${opts.email}
       WHERE id = ${ped.id}::uuid`);
  });
}

export async function listarPedidosLelis(lelisId: string) {
  const peds = linhas<{
    id: string; numero: number; destino_filial_id: string; status: string; total: number; vencimento: string;
    observacao: string | null; criado_em: string; criado_por: string | null; casa_pagou: boolean | null; lelis_recebeu: boolean | null;
    recebido_em: string | null; recebido_por: string | null;
  }>(
    await db.execute(sql`
      SELECT p.id, p.numero, p.destino_filial_id, p.status, p.total::float AS total, p.vencimento::text AS vencimento,
             p.observacao, p.criado_em::text AS criado_em, p.criado_por,
             (p.recebido_em AT TIME ZONE 'America/Sao_Paulo')::text AS recebido_em, p.recebido_por,
             (c.data_pagamento IS NOT NULL) AS casa_pagou,
             (SELECT bool_or(r.recebido_em IS NOT NULL) FROM revenda_receber r WHERE r.revenda_pedido_id = p.id) AS lelis_recebeu
        FROM revenda_pedido p
        LEFT JOIN conta_pagar c ON c.id = p.conta_pagar_id
       WHERE p.filial_id = ${lelisId}::uuid
       ORDER BY p.criado_em DESC
       LIMIT 100`),
  );
  const itens = peds.length
    ? linhas<{ pedido_id: string; descricao: string; quantidade: number; preco_unit: number; total: number; produto_casa: string | null; quantidade_recebida: number | null }>(
        await db.execute(sql`
          SELECT i.pedido_id, i.descricao, i.quantidade::float AS quantidade, i.preco_unit::float AS preco_unit, i.total::float AS total,
                 pc.nome AS produto_casa, i.quantidade_recebida::float AS quantidade_recebida
            FROM revenda_pedido_item i
            LEFT JOIN produto pc ON pc.id = i.produto_casa_id
           WHERE i.pedido_id IN (${sql.join(peds.map((p) => sql`${p.id}::uuid`), sql`, `)})
           ORDER BY descricao`),
      )
    : [];
  return peds.map((p) => ({
    ...p,
    casa: CASAS_PEDIDO[p.destino_filial_id] ?? '?',
    criadoEmBr: dateToBrYmd(new Date(p.criado_em)),
    itens: itens.filter((i) => i.pedido_id === p.id),
  }));
}


// ---------------------------------------------------------------------------
// Produto da casa pra cada item da Lelis. Ordem da sugestão:
//  1. vínculo já salvo (escolhido num pedido anterior);
//  2. mesmo código de barras (cadastro de fornecedor ou nota de compra da casa);
//  3. nome parecido — empate vai pro que controla estoque e, no Bar/Mar, pro
//     INSUMO (é nele que a venda da bebida baixa).

const PALAVRAS_FORA = new Set([
  'vinho', 'tinto', 'branco', 'rose', 'tn', 'br', 'ro', 'rs', 'rose', 'ml', '750ml', '375ml', '1500ml', 'promo', 'pj', 'min',
  'de', 'da', 'do', 'des', 'di', 'del', 'la', 'le', 'el', 'e', 'i', 'arg', 'chi', 'ita', 'por', 'pt', 'fra', 'esp', 'uru', 'bra',
  'garrafa', 'gf', 'un', 'cx', 'docg', 'doc', 'igp', 'igt', 'aoc',
]);
const tokens = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !PALAVRAS_FORA.has(t) && !/^\d+([.,]\d+)?$/.test(t));

export interface ProdutoCasaOpcao {
  id: string;
  nome: string;
  tipo: string | null;
  unidade: string | null;
  estoque: number;
}

export async function sugerirProdutosCasa(opts: { lelisId: string; casaId: string; revIds: string[] }) {
  if (!CASAS_PEDIDO[opts.casaId]) throw new RecusaPedido('casa inválida');
  const produtos = linhas<ProdutoCasaOpcao & { controla: boolean }>(
    await db.execute(sql`
      SELECT id, nome, tipo, unidade_estoque AS unidade, coalesce(estoque_atual, 0)::float AS estoque,
             coalesce(controla_estoque, false) AS controla
        FROM produto
       WHERE filial_id = ${opts.casaId}::uuid AND coalesce(descontinuado, false) = false
         AND nome NOT ILIKE '* Exclu%'
       ORDER BY nome`),
  );
  const sugestoes: Record<string, { produtoId: string; fonte: string }> = {};
  if (!opts.revIds.length) return { produtos, sugestoes };
  const revs = linhas<{ id: string; descricao: string; ean: string | null }>(
    await db.execute(sql`
      SELECT id, descricao, ean FROM revenda_produto
       WHERE filial_id = ${opts.lelisId}::uuid AND id IN (${sql.join(opts.revIds.map((i) => sql`${i}::uuid`), sql`, `)})`),
  );
  const salvos = linhas<{ revenda_produto_id: string; produto_id: string }>(
    await db.execute(sql`
      SELECT v.revenda_produto_id, v.produto_id FROM revenda_produto_casa v
        JOIN produto p ON p.id = v.produto_id
       WHERE v.casa_filial_id = ${opts.casaId}::uuid
         AND v.revenda_produto_id IN (${sql.join(opts.revIds.map((i) => sql`${i}::uuid`), sql`, `)})`),
  );
  for (const v of salvos) sugestoes[v.revenda_produto_id] = { produtoId: v.produto_id, fonte: 'escolhido antes' };

  const eans = [...new Set(revs.filter((r) => !sugestoes[r.id] && r.ean).map((r) => r.ean!))];
  const porEan = new Map<string, string>();
  if (eans.length) {
    const achados = linhas<{ ean: string; produto_id: string }>(
      await db.execute(sql`
        SELECT DISTINCT ON (ean) ean, produto_id FROM (
          SELECT pf.ean, pf.produto_id, 1 AS ordem FROM produto_fornecedor pf
           WHERE pf.filial_id = ${opts.casaId}::uuid AND pf.ean IN (${sql.join(eans.map((e) => sql`${e}`), sql`, `)})
          UNION ALL
          SELECT ni.ean, ni.produto_id, 2 FROM nota_compra_item ni
           WHERE ni.filial_id = ${opts.casaId}::uuid AND ni.produto_id IS NOT NULL
             AND ni.ean IN (${sql.join(eans.map((e) => sql`${e}`), sql`, `)})
        ) x ORDER BY ean, ordem`),
    );
    const validos = new Set(produtos.map((p) => p.id));
    for (const a of achados) if (validos.has(a.produto_id)) porEan.set(a.ean, a.produto_id);
  }

  // tamanho da garrafa (750ml × 375ml) tem que bater quando os dois dizem
  const ml = (n: string) => {
    const m = n.toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(ml|l)\b/);
    if (!m) return null;
    const v = Number(m[1]!.replace(',', '.'));
    return m[2] === 'l' ? Math.round(v * 1000) : Math.round(v);
  };
  // cor: TN/BR/RO na Lelis; tinto/branco/rosé no nome da casa
  const cor = (n: string) => {
    const x = n.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    if (/\b(tn|tinto)\b/.test(x)) return 'T';
    if (/\b(ro|rose)\b/.test(x)) return 'R';
    if (/\b(br|branco)\b/.test(x)) return 'B';
    return null;
  };
  const tokProd = produtos.map((p) => ({ p, t: new Set(tokens(p.nome)), ml: ml(p.nome), cor: cor(p.nome) }));
  for (const r of revs) {
    if (sugestoes[r.id]) continue;
    if (r.ean && porEan.has(r.ean)) {
      sugestoes[r.id] = { produtoId: porEan.get(r.ean)!, fonte: 'código de barras' };
      continue;
    }
    const tr = tokens(r.descricao);
    if (!tr.length) continue;
    let melhor: { id: string; nota: number } | null = null;
    const mlRev = ml(r.descricao);
    const corRev = cor(r.descricao);
    for (const { p, t, ml: mlP, cor: corP } of tokProd) {
      if (!t.size) continue;
      if (mlRev && mlP && mlRev !== mlP) continue;
      if (corRev && corP && corRev !== corP) continue;
      const comum = tr.filter((x) => t.has(x)).length;
      if (!comum) continue;
      // cobre o nome da Lelis e não tem muita palavra sobrando no da casa
      let nota = comum / tr.length - 0.15 * ((t.size - comum) / t.size);
      if (p.controla) nota += 0.02;
      if (p.tipo === 'INSUMO') nota += 0.01;
      if (!melhor || nota > melhor.nota) melhor = { id: p.id, nota };
    }
    if (melhor && melhor.nota >= 0.6) sugestoes[r.id] = { produtoId: melhor.id, fonte: 'nome parecido — confira' };
  }
  return { produtos: produtos.map(({ controla: _c, ...p }) => p), sugestoes };
}


// ---------------------------------------------------------------------------
// Conferência na casa: cada item diz o que chegou e em qual produto da casa
// entra. Entrada = ENTRADA_COMPRA ao preço do pedido (custo médio). Falta volta
// pro estoque da Lelis e abate o valor do pedido (a receber e conta a pagar).

export interface ItemConferencia {
  itemId: string;
  quantidadeRecebida: number;
  /** null = chegou mas não controla estoque na casa (não dá entrada) */
  produtoCasaId: string | null;
  /** O vinho não existe nesta casa: traz o cadastro deste produto de OUTRA casa
   *  (cadastra aqui igual) e dá entrada nele. Pedido do dono 11/11/2026. */
  produtoOutraCasaId?: string | null;
  /** Não existe em casa nenhuma: cadastra aqui a partir do item da Lelis. */
  cadastrar?: boolean;
}

/** Produto parecido nas OUTRAS casas, pra oferecer na conferência quando a casa
 *  que recebe não tem o vinho (11/11/2026). */
export interface OpcaoOutraCasa {
  produtoId: string;
  nome: string;
  casa: string;
  fonte: string;
}

export async function sugerirDeOutrasCasas(opts: { lelisId: string; casaId: string; revIds: string[] }) {
  const out: Record<string, OpcaoOutraCasa[]> = {};
  for (const [outraId, casa] of Object.entries(CASAS_PEDIDO)) {
    if (outraId === opts.casaId) continue;
    const s = await sugerirProdutosCasa({ lelisId: opts.lelisId, casaId: outraId, revIds: opts.revIds });
    const nomes = new Map(s.produtos.map((p) => [p.id, p.nome]));
    for (const [revId, sg] of Object.entries(s.sugestoes)) {
      const nome = nomes.get(sg.produtoId);
      if (!nome) continue;
      (out[revId] ??= []).push({ produtoId: sg.produtoId, nome, casa, fonte: sg.fonte });
    }
  }
  return out;
}

/** Produto de estoque novo na casa (INSUMO da nuvem, igual ao que a
 *  transferência entre casas cadastra). Se já existe um com o MESMO nome na
 *  casa, usa ele — não duplica. */
async function cadastrarProdutoNaCasa(
  tx: Tx,
  casaId: string,
  d: {
    nome: string; descricao?: string | null; unidade?: string | null; ncm?: string | null; cest?: string | null;
    itemPorKg?: boolean | null; pesoUnitarioPadraoKg?: string | null; volumeUnitarioMl?: string | null;
    categoriaCompras?: string | null; descricaoCompra?: string | null;
  },
): Promise<string> {
  const nome = d.nome.trim();
  const [igual] = linhas<{ id: string }>(
    await tx.execute(sql`
      SELECT id FROM produto
       WHERE filial_id = ${casaId}::uuid AND coalesce(descontinuado, false) = false
         AND lower(btrim(nome)) = lower(${nome})
       ORDER BY coalesce(controla_estoque, false) DESC LIMIT 1`),
  );
  if (igual) return igual.id;
  const [novo] = await tx
    .insert(schema.produto)
    .values({
      filialId: casaId,
      codigoExterno: null,
      nome,
      descricao: d.descricao ?? null,
      tipo: 'INSUMO',
      unidadeEstoque: d.unidade || 'un',
      controlaEstoque: true,
      estoqueControlado: true,
      criadoNaNuvem: true,
      descontinuado: false,
      estoqueAtual: '0',
      precoCusto: '0',
      itemPorKg: d.itemPorKg ?? undefined,
      pesoUnitarioPadraoKg: d.pesoUnitarioPadraoKg ?? undefined,
      volumeUnitarioMl: d.volumeUnitarioMl ?? undefined,
      categoriaCompras: d.categoriaCompras ?? undefined,
      descricaoCompra: d.descricaoCompra ?? undefined,
      ncm: d.ncm ?? undefined,
      cest: d.cest ?? undefined,
    })
    .returning({ id: schema.produto.id });
  if (!novo) throw new Error('falha ao cadastrar produto na casa');
  return novo.id;
}

export async function receberPedidoLelis(opts: {
  pedidoId: string;
  casaId: string;
  itens: ItemConferencia[];
  observacao?: string | null;
  userId: string;
  email: string;
}): Promise<{ numero: number; total: number; faltas: number }> {
  return db.transaction(async (tx) => {
    const [ped] = linhas<{ id: string; numero: number; status: string; destino: string; recebido_em: string | null; conta_pagar_id: string | null; total: number; filial_id: string }>(
      await tx.execute(sql`
        SELECT id, numero, status, destino_filial_id AS destino, recebido_em::text, conta_pagar_id, total::float AS total, filial_id
          FROM revenda_pedido WHERE id = ${opts.pedidoId}::uuid FOR UPDATE`),
    );
    if (!ped || ped.destino !== opts.casaId) throw new RecusaPedido('pedido não encontrado nesta casa');
    if (ped.status === 'CANCELADO') throw new RecusaPedido('pedido cancelado pela Lelis');
    if (ped.recebido_em) throw new RecusaPedido('esse pedido já foi conferido');

    const itens = linhas<{ id: string; revenda_produto_id: string; descricao: string; quantidade: number; preco_unit: number; custo_unit: number }>(
      await tx.execute(sql`
        SELECT id, revenda_produto_id, descricao, quantidade::float AS quantidade, preco_unit::float AS preco_unit, custo_unit::float AS custo_unit
          FROM revenda_pedido_item WHERE pedido_id = ${ped.id}::uuid`),
    );
    const inf = new Map(opts.itens.map((i) => [i.itemId, i]));
    if (opts.itens.some((i) => !itens.some((x) => x.id === i.itemId))) throw new RecusaPedido('item não é desse pedido');

    // Vinho que a casa não tem (11/11/2026): traz o cadastro da outra casa ou
    // cadastra do item da Lelis — e segue como se tivesse escolhido o produto.
    const doItem = new Map(itens.map((x) => [x.id, x]));
    const jaDaOutra = new Map<string, string>();
    const jaNovo = new Map<string, string>();
    for (const i of opts.itens) {
      if (i.produtoCasaId || !(i.quantidadeRecebida > 0)) continue;
      const it = doItem.get(i.itemId)!;
      if (i.produtoOutraCasaId) {
        let dest = jaDaOutra.get(i.produtoOutraCasaId);
        if (!dest) {
          const [po] = await tx.select().from(schema.produto).where(eq(schema.produto.id, i.produtoOutraCasaId));
          if (!po || po.filialId === opts.casaId || !CASAS_PEDIDO[po.filialId]) {
            throw new RecusaPedido(`"${it.descricao}": o produto da outra casa não foi encontrado`);
          }
          const [dp] = linhas<{ id: string }>(
            await tx.execute(sql`
              SELECT p.id FROM produto_depara_filial d JOIN produto p ON p.id = d.produto_destino_id
               WHERE d.produto_origem_id = ${po.id}::uuid AND d.filial_destino_id = ${opts.casaId}::uuid
                 AND p.filial_id = ${opts.casaId}::uuid AND coalesce(p.descontinuado, false) = false
               LIMIT 1`),
          );
          dest =
            dp?.id ??
            (await cadastrarProdutoNaCasa(tx, opts.casaId, {
              nome: po.nome ?? it.descricao, descricao: po.descricao, unidade: po.unidadeEstoque, ncm: po.ncm, cest: po.cest,
              itemPorKg: po.itemPorKg, pesoUnitarioPadraoKg: po.pesoUnitarioPadraoKg, volumeUnitarioMl: po.volumeUnitarioMl,
              categoriaCompras: po.categoriaCompras, descricaoCompra: po.descricaoCompra,
            }));
          // de/para nas duas direções: a transferência entre casas já acha o par
          for (const [o, f, d] of [[po.id, opts.casaId, dest], [dest, po.filialId, po.id]] as const) {
            await tx.execute(sql`
              INSERT INTO produto_depara_filial (produto_origem_id, filial_destino_id, produto_destino_id, atualizado_por, atualizado_em)
              VALUES (${o}::uuid, ${f}::uuid, ${d}::uuid, ${opts.userId}::uuid, now())
              ON CONFLICT (produto_origem_id, filial_destino_id) DO NOTHING`);
          }
          jaDaOutra.set(i.produtoOutraCasaId, dest);
        }
        i.produtoCasaId = dest;
      } else if (i.cadastrar) {
        let dest = jaNovo.get(it.revenda_produto_id);
        if (!dest) {
          const [rp] = linhas<{ unidade: string | null; ncm: string | null; cest: string | null }>(
            await tx.execute(sql`SELECT unidade, ncm, cest FROM revenda_produto WHERE id = ${it.revenda_produto_id}::uuid`),
          );
          dest = await cadastrarProdutoNaCasa(tx, opts.casaId, {
            nome: it.descricao, unidade: (rp?.unidade || 'un').toLowerCase(), ncm: rp?.ncm, cest: rp?.cest,
          });
          jaNovo.set(it.revenda_produto_id, dest);
        }
        i.produtoCasaId = dest;
      }
    }

    const idsCasa = [...new Set(opts.itens.map((i) => i.produtoCasaId).filter((x): x is string => !!x))];
    if (idsCasa.length) {
      const pc = linhas<{ id: string }>(
        await tx.execute(sql`
          SELECT id FROM produto WHERE filial_id = ${opts.casaId}::uuid
             AND id IN (${sql.join(idsCasa.map((i) => sql`${i}::uuid`), sql`, `)}) FOR UPDATE`),
      );
      if (pc.length !== idsCasa.length) throw new RecusaPedido('produto escolhido não é do estoque desta casa');
    }

    if (itens.every((it) => (inf.get(it.id)?.quantidadeRecebida ?? it.quantidade) <= 0)) {
      throw new RecusaPedido('nada chegou — peça pra Lelis cancelar o pedido');
    }
    const agora = new Date();
    const rotulo = `Pedido Lelis nº ${ped.numero} (sem nota)`;
    let novoTotal = 0;
    let faltas = 0;
    for (const it of itens) {
      const c = inf.get(it.id);
      const qr = c ? c.quantidadeRecebida : it.quantidade;
      if (!(qr >= 0) || qr > it.quantidade + 1e-9) {
        throw new RecusaPedido(`"${it.descricao}": recebido tem que ficar entre 0 e ${it.quantidade}`);
      }
      const prodCasa = c ? c.produtoCasaId : null;
      if (qr > 0 && !c) throw new RecusaPedido(`"${it.descricao}": escolha o produto da casa`);
      novoTotal += r2(qr * it.preco_unit);
      let movId: string | null = null;
      if (qr > 0 && prodCasa) {
        const [mov] = await tx
          .insert(schema.movimentoEstoque)
          .values({
            filialId: opts.casaId,
            produtoId: prodCasa,
            tipo: 'ENTRADA_COMPRA',
            quantidade: qr.toFixed(4),
            precoUnitario: it.preco_unit.toFixed(6),
            valorTotal: r2(qr * it.preco_unit).toFixed(2),
            dataHora: agora,
            observacao: `${rotulo} — ${it.descricao} — conferido no recebimento`,
            criadoPor: opts.userId,
          })
          .returning({ id: schema.movimentoEstoque.id });
        await aplicarMpmEntrada({ produtoId: prodCasa, qtdEntrada: qr, custoEntrada: it.preco_unit, exec: tx });
        movId = mov?.id ?? null;
        await tx.execute(sql`
          INSERT INTO revenda_produto_casa (revenda_produto_id, casa_filial_id, produto_id, atualizado_em, atualizado_por)
          VALUES (${it.revenda_produto_id}::uuid, ${opts.casaId}::uuid, ${prodCasa}::uuid, now(), ${opts.email})
          ON CONFLICT (revenda_produto_id, casa_filial_id)
          DO UPDATE SET produto_id = excluded.produto_id, atualizado_em = now(), atualizado_por = excluded.atualizado_por`);
      }
      const falta = Math.round((it.quantidade - qr) * 10000) / 10000;
      if (falta > 0) {
        faltas++;
        // não chegou: volta pro estoque da Lelis
        await tx.execute(sql`
          INSERT INTO revenda_movimento (filial_id, revenda_produto_id, tipo, quantidade, custo_unit, revenda_pedido_id, observacao, criado_por)
          VALUES (${ped.filial_id}::uuid, ${it.revenda_produto_id}::uuid, 'ESTORNO_PEDIDO', ${String(falta)}::numeric,
                  ${it.custo_unit.toFixed(4)}::numeric, ${ped.id}::uuid,
                  ${`${rotulo}: faltou no recebimento (enviado ${it.quantidade}, chegou ${qr})`}, ${opts.email})`);
      }
      await tx.execute(sql`
        UPDATE revenda_pedido_item
           SET quantidade_recebida = ${qr.toFixed(4)}::numeric, produto_casa_id = ${prodCasa}::uuid, movimento_casa_id = ${movId}::uuid
         WHERE id = ${it.id}::uuid`);
    }
    novoTotal = r2(novoTotal);

    if (Math.abs(novoTotal - ped.total) > 0.004) {
      // faltou item: abate o valor dos dois lados (só se ninguém pagou ainda)
      if (ped.conta_pagar_id) {
        const [cp] = linhas<{ pago: boolean }>(
          await tx.execute(sql`
            SELECT (c.data_pagamento IS NOT NULL OR EXISTS (SELECT 1 FROM conta_pagar_baixa b WHERE b.conta_pagar_id = c.id)) AS pago
              FROM conta_pagar c WHERE c.id = ${ped.conta_pagar_id}::uuid`),
        );
        if (cp?.pago) throw new RecusaPedido('a conta desse pedido já foi paga — fale com a Lelis pra acertar a falta');
        await tx.execute(sql`UPDATE conta_pagar SET valor = ${novoTotal.toFixed(2)}::numeric WHERE id = ${ped.conta_pagar_id}::uuid`);
      }
      const [rec] = linhas<{ recebido: boolean }>(
        await tx.execute(sql`SELECT bool_or(recebido_em IS NOT NULL) AS recebido FROM revenda_receber WHERE revenda_pedido_id = ${ped.id}::uuid`),
      );
      if (rec?.recebido) throw new RecusaPedido('a Lelis já deu esse pedido como recebido — fale com a Lelis pra acertar a falta');
      await tx.execute(sql`UPDATE revenda_receber SET valor = ${novoTotal.toFixed(2)}::numeric WHERE revenda_pedido_id = ${ped.id}::uuid AND NOT cancelado`);
    }
    await tx.execute(sql`
      UPDATE revenda_pedido
         SET recebido_em = now(), recebido_por = ${opts.email}, observacao_recebimento = ${opts.observacao?.trim() || null},
             total = ${novoTotal.toFixed(2)}::numeric
       WHERE id = ${ped.id}::uuid`);
    return { numero: ped.numero, total: novoTotal, faltas };
  });
}

/** Pedidos da Lelis pra esta casa que ainda não foram conferidos. */
export async function pedidosLelisAConferir(casaId: string) {
  const peds = linhas<{ id: string; numero: number; total: number; criado: string; observacao: string | null }>(
    await db.execute(sql`
      SELECT id, numero, total::float AS total, (criado_em AT TIME ZONE 'America/Sao_Paulo')::date::text AS criado, observacao
        FROM revenda_pedido
       WHERE destino_filial_id = ${casaId}::uuid AND status <> 'CANCELADO' AND recebido_em IS NULL
       ORDER BY numero`),
  );
  if (!peds.length) return [];
  const its = linhas<{ pedido_id: string; descricao: string; quantidade: number }>(
    await db.execute(sql`
      SELECT pedido_id, descricao, quantidade::float AS quantidade FROM revenda_pedido_item
       WHERE pedido_id IN (${sql.join(peds.map((p) => sql`${p.id}::uuid`), sql`, `)}) ORDER BY descricao`),
  );
  return peds.map((p) => ({ ...p, itens: its.filter((i) => i.pedido_id === p.id) }));
}

/** Pedido + itens pra tela de conferência (com sugestão de produto da casa). */
export async function pedidoLelisParaConferir(pedidoId: string, casaId: string) {
  const [ped] = linhas<{ id: string; numero: number; total: number; criado: string; observacao: string | null; status: string; recebido_em: string | null; filial_id: string; vencimento: string }>(
    await db.execute(sql`
      SELECT id, numero, total::float AS total, (criado_em AT TIME ZONE 'America/Sao_Paulo')::date::text AS criado, observacao,
             status, recebido_em::text, filial_id, vencimento::text
        FROM revenda_pedido WHERE id = ${pedidoId}::uuid AND destino_filial_id = ${casaId}::uuid`),
  );
  if (!ped) return null;
  const itens = linhas<{ id: string; revenda_produto_id: string; descricao: string; quantidade: number; preco_unit: number; quantidade_recebida: number | null; produto_casa: string | null }>(
    await db.execute(sql`
      SELECT i.id, i.revenda_produto_id, i.descricao, i.quantidade::float AS quantidade, i.preco_unit::float AS preco_unit,
             i.quantidade_recebida::float AS quantidade_recebida, pc.nome AS produto_casa
        FROM revenda_pedido_item i LEFT JOIN produto pc ON pc.id = i.produto_casa_id
       WHERE i.pedido_id = ${ped.id}::uuid ORDER BY i.descricao`),
  );
  const sug = await sugerirProdutosCasa({ lelisId: ped.filial_id, casaId, revIds: [...new Set(itens.map((i) => i.revenda_produto_id))] });
  const revIds = [...new Set(itens.map((i) => i.revenda_produto_id))];
  // só busca nas outras casas quando o pedido ainda está pra conferir
  const outras = ped.recebido_em || ped.status === 'CANCELADO' ? {} : await sugerirDeOutrasCasas({ lelisId: ped.filial_id, casaId, revIds });
  return { pedido: ped, itens, produtos: sug.produtos, sugestoes: sug.sugestoes, outras };
}

/** Pedido inteiro pra tela /lelis/pedido/[id] (dono 06/11/2026: "não consigo abrir o pedido"). */
export async function pedidoLelisDetalhe(lelisId: string, pedidoId: string) {
  const [ped] = linhas<{
    id: string; numero: number; destino_filial_id: string; status: string; total: number; vencimento: string;
    observacao: string | null; observacao_recebimento: string | null; criado_em: string; criado_por: string | null;
    recebido_em: string | null; recebido_por: string | null; cancelado_em: string | null; cancelado_por: string | null;
    conta_pagar_id: string | null; casa_pagou_em: string | null;
  }>(
    await db.execute(sql`
      SELECT p.id, p.numero, p.destino_filial_id, p.status, p.total::float AS total, p.vencimento::text AS vencimento,
             p.observacao, p.observacao_recebimento,
             to_char(p.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS criado_em, p.criado_por,
             to_char(p.recebido_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS recebido_em, p.recebido_por,
             to_char(p.cancelado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS cancelado_em, p.cancelado_por,
             p.conta_pagar_id, c.data_pagamento::text AS casa_pagou_em
        FROM revenda_pedido p
        LEFT JOIN conta_pagar c ON c.id = p.conta_pagar_id
       WHERE p.id = ${pedidoId}::uuid AND p.filial_id = ${lelisId}::uuid`),
  );
  if (!ped) return null;
  const itens = linhas<{
    id: string; descricao: string; quantidade: number; preco_unit: number; total: number;
    quantidade_recebida: number | null; produto_casa_id: string | null; produto_casa: string | null;
  }>(
    await db.execute(sql`
      SELECT i.id, i.descricao, i.quantidade::float AS quantidade, i.preco_unit::float AS preco_unit, i.total::float AS total,
             i.quantidade_recebida::float AS quantidade_recebida, i.produto_casa_id, pc.nome AS produto_casa
        FROM revenda_pedido_item i LEFT JOIN produto pc ON pc.id = i.produto_casa_id
       WHERE i.pedido_id = ${ped.id}::uuid ORDER BY i.descricao`),
  );
  const receber = linhas<{ vencimento: string; valor: number; recebido_em: string | null; valor_recebido: number | null; cancelado: boolean }>(
    await db.execute(sql`
      SELECT vencimento::text AS vencimento, valor::float AS valor, recebido_em::text AS recebido_em,
             valor_recebido::float AS valor_recebido, cancelado
        FROM revenda_receber WHERE revenda_pedido_id = ${ped.id}::uuid ORDER BY vencimento`),
  );
  return { pedido: { ...ped, casa: CASAS_PEDIDO[ped.destino_filial_id] ?? '?' }, itens, receber };
}
