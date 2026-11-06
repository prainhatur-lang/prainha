// Pedido SEM NOTA da Lelis pras casas (06/11/2026). Pedido do dono: mandar
// caixas pro Bar, Mar e Tabuará sem emitir nota por enquanto, com o controle do
// dinheiro — a Lelis (Alex) recebe das casas pra pagar os fornecedores.
//
// Um pedido faz, numa transação só:
//  - baixa o estoque da Lelis (revenda_movimento SAIDA_PEDIDO);
//  - lança o a receber da Lelis (revenda_receber, comprador = a casa);
//  - lança a conta a pagar NA CASA (origem LELIS, fornecedor Lelis);
//  - dá ENTRADA no estoque da casa (movimento_estoque ENTRADA_COMPRA + custo
//    médio) no produto da casa vinculado ao da Lelis (revenda_produto_casa).
// Cancelar devolve o estoque, cancela o a receber e apaga a conta da casa
// (só se a casa ainda não pagou).

import { db, schema } from '@concilia/db';
import { sql } from 'drizzle-orm';
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
  /** Produto da casa que recebe a entrada. null = não dá entrada nesse item. */
  produtoCasaId?: string | null;
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
    const idsCasa = [...new Set(itens.map((i) => i.produtoCasaId).filter((x): x is string => !!x))];
    const nomeCasa = new Map<string, string>();
    if (idsCasa.length) {
      const pc = linhas<{ id: string; nome: string }>(
        await tx.execute(sql`
          SELECT id, nome FROM produto
           WHERE filial_id = ${opts.destinoId}::uuid AND id IN (${sql.join(idsCasa.map((i) => sql`${i}::uuid`), sql`, `)})`),
      );
      for (const p of pc) nomeCasa.set(p.id, p.nome);
      if (pc.length !== idsCasa.length) throw new RecusaPedido(`produto escolhido não é do estoque de ${casa}`);
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

    const agora = new Date();
    for (const it of itens) {
      const p = porId.get(it.produtoId)!;
      // Entrada no estoque da casa, ao preço do pedido (vira o custo médio lá).
      let movCasaId: string | null = null;
      if (it.produtoCasaId) {
        const valor = r2(it.quantidade * it.precoUnit);
        const [mov] = await tx
          .insert(schema.movimentoEstoque)
          .values({
            filialId: opts.destinoId,
            produtoId: it.produtoCasaId,
            tipo: 'ENTRADA_COMPRA',
            quantidade: it.quantidade.toFixed(4),
            precoUnitario: it.precoUnit.toFixed(6),
            valorTotal: valor.toFixed(2),
            dataHora: agora,
            observacao: `${rotulo} — ${p.descricao}`,
            criadoPor: opts.userId,
          })
          .returning({ id: schema.movimentoEstoque.id });
        await aplicarMpmEntrada({ produtoId: it.produtoCasaId, qtdEntrada: it.quantidade, custoEntrada: it.precoUnit, exec: tx });
        movCasaId = mov?.id ?? null;
        await tx.execute(sql`
          INSERT INTO revenda_produto_casa (revenda_produto_id, casa_filial_id, produto_id, atualizado_em, atualizado_por)
          VALUES (${p.id}::uuid, ${opts.destinoId}::uuid, ${it.produtoCasaId}::uuid, now(), ${opts.email})
          ON CONFLICT (revenda_produto_id, casa_filial_id)
          DO UPDATE SET produto_id = excluded.produto_id, atualizado_em = now(), atualizado_por = excluded.atualizado_por`);
      }
      await tx.execute(sql`
        INSERT INTO revenda_pedido_item (pedido_id, revenda_produto_id, descricao, quantidade, preco_unit, custo_unit, total,
                                         produto_casa_id, movimento_casa_id)
        VALUES (${ped.id}::uuid, ${p.id}::uuid, ${p.descricao}, ${String(it.quantidade)}::numeric,
                ${it.precoUnit.toFixed(4)}::numeric, ${p.custo.toFixed(4)}::numeric,
                ${r2(it.quantidade * it.precoUnit).toFixed(2)}::numeric,
                ${it.produtoCasaId ?? null}::uuid, ${movCasaId}::uuid)`);
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
      SELECT filial_id, revenda_produto_id, 'ESTORNO_PEDIDO', -quantidade, custo_unit, revenda_pedido_id,
             'Cancelamento: ' || coalesce(observacao, 'pedido'), ${opts.email}
        FROM revenda_movimento
       WHERE revenda_pedido_id = ${ped.id}::uuid AND tipo = 'SAIDA_PEDIDO'
      ON CONFLICT DO NOTHING`);
    // Tira da casa o que entrou no estoque dela (mesmo custo da entrada).
    const entradas = linhas<{ id: string; produto_casa_id: string; quantidade: number; preco_unit: number; descricao: string; destino: string }>(
      await tx.execute(sql`
        SELECT i.id, i.produto_casa_id, i.quantidade::float AS quantidade, i.preco_unit::float AS preco_unit, i.descricao,
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
  }>(
    await db.execute(sql`
      SELECT p.id, p.numero, p.destino_filial_id, p.status, p.total::float AS total, p.vencimento::text AS vencimento,
             p.observacao, p.criado_em::text AS criado_em, p.criado_por,
             (c.data_pagamento IS NOT NULL) AS casa_pagou,
             (SELECT bool_or(r.recebido_em IS NOT NULL) FROM revenda_receber r WHERE r.revenda_pedido_id = p.id) AS lelis_recebeu
        FROM revenda_pedido p
        LEFT JOIN conta_pagar c ON c.id = p.conta_pagar_id
       WHERE p.filial_id = ${lelisId}::uuid
       ORDER BY p.criado_em DESC
       LIMIT 100`),
  );
  const itens = peds.length
    ? linhas<{ pedido_id: string; descricao: string; quantidade: number; preco_unit: number; total: number; produto_casa: string | null }>(
        await db.execute(sql`
          SELECT i.pedido_id, i.descricao, i.quantidade::float AS quantidade, i.preco_unit::float AS preco_unit, i.total::float AS total,
                 pc.nome AS produto_casa
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
  'vinho', 'tinto', 'branco', 'rose', 'tn', 'br', 'rs', 'rose', 'ml', '750ml', '375ml', '1500ml', 'promo', 'pj', 'min',
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
