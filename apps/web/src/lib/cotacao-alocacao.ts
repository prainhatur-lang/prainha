// Algoritmo de alocacao da cotacao: pra cada item, escolhe vencedor inicialmente
// como menor preco_unitario_normalizado. Apos, reassigna itens cujo fornecedor
// nao atinge valor_pedido_minimo pro proximo colocado, iterativamente ate
// estabilizar.
//
// Reusado em:
//   - /api/cotacao/[id]/preview-aprovacao (so calcula, nao escreve)
//   - /api/cotacao/[id]/aprovar (calcula + escreve)

import { db, schema } from '@concilia/db';
import { eq, inArray } from 'drizzle-orm';

/** Compara marca ignorando acento, espaço e caixa: "Dragao" = "Dragão",
 *  "Bom bril" = "Bombril". Fornecedor digita no celular — exigir grafia
 *  exata descartava resposta legítima (e a mais barata). */
export function normalizaMarca(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export interface ItemAlocado {
  itemId: string;
  produtoId: string;
  produtoNome: string | null;
  qtd: string;
  unidade: string;
  /** Indice no array sorted por preco. 0 = vencedor original, 1 = 2 colocado, etc. */
  ranque: number;
  /** Resposta vencedora apos alocacao */
  respostaId: string;
  preco: number;
  precoTotal: number;
  marcaId: string | null;
  marcaNome: string | null;
  cotacaoFornecedorId: string;
  fornecedorId: string;
  fornecedorNome: string | null;
}

export interface FornecedorAlocacao {
  fornecedorId: string;
  fornecedorNome: string | null;
  cotacaoFornecedorId: string;
  itens: ItemAlocado[];
  total: number;
  valorPedidoMinimo: number | null;
  atingeMinimo: boolean;
}

export interface ItemOrfao {
  itemId: string;
  produtoId: string;
  produtoNome: string | null;
  qtd: string;
  unidade: string;
  motivo: 'sem_resposta' | 'esgotou_colocados';
}

export interface ResultadoAlocacao {
  porFornecedor: FornecedorAlocacao[];
  orfaos: ItemOrfao[];
  reassignados: Array<{
    itemId: string;
    produtoNome: string | null;
    ranqueOriginal: number;
    ranqueFinal: number;
    fornecedorOriginal: string | null;
    fornecedorFinal: string;
  }>;
  totalGeral: number;
}

export async function calcularAlocacaoCotacao(cotacaoId: string): Promise<ResultadoAlocacao> {
  // Itens da cotacao + nome do produto
  const itens = await db
    .select({
      id: schema.cotacaoItem.id,
      produtoId: schema.cotacaoItem.produtoId,
      quantidade: schema.cotacaoItem.quantidade,
      unidade: schema.cotacaoItem.unidade,
      marcasAceitas: schema.cotacaoItem.marcasAceitas,
      produtoNome: schema.produto.nome,
    })
    .from(schema.cotacaoItem)
    .leftJoin(schema.produto, eq(schema.produto.id, schema.cotacaoItem.produtoId))
    .where(eq(schema.cotacaoItem.cotacaoId, cotacaoId));

  // Convocacoes + dados do fornecedor (nome, valor_pedido_minimo)
  const convocacoes = await db
    .select({
      cotForId: schema.cotacaoFornecedor.id,
      fornecedorId: schema.cotacaoFornecedor.fornecedorId,
      fornecedorNome: schema.fornecedor.nome,
      valorPedidoMinimo: schema.fornecedor.valorPedidoMinimo,
    })
    .from(schema.cotacaoFornecedor)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.cotacaoFornecedor.fornecedorId))
    .where(eq(schema.cotacaoFornecedor.cotacaoId, cotacaoId));

  const dadosForn = new Map(
    convocacoes.map((c) => [
      c.cotForId,
      {
        fornecedorId: c.fornecedorId,
        nome: c.fornecedorNome,
        minimo: c.valorPedidoMinimo ? Number(c.valorPedidoMinimo) : null,
      },
    ]),
  );

  // Respostas
  const respostas = await db
    .select({
      id: schema.cotacaoRespostaItem.id,
      cotacaoFornecedorId: schema.cotacaoRespostaItem.cotacaoFornecedorId,
      cotacaoItemId: schema.cotacaoRespostaItem.cotacaoItemId,
      precoUnitario: schema.cotacaoRespostaItem.precoUnitario,
      precoUnitarioNormalizado: schema.cotacaoRespostaItem.precoUnitarioNormalizado,
      marcaId: schema.cotacaoRespostaItem.marcaId,
      marcaNome: schema.marca.nome,
    })
    .from(schema.cotacaoRespostaItem)
    .leftJoin(schema.marca, eq(schema.marca.id, schema.cotacaoRespostaItem.marcaId))
    .where(
      inArray(
        schema.cotacaoRespostaItem.cotacaoFornecedorId,
        convocacoes.map((c) => c.cotForId),
      ),
    );

  // MARCA ACEITA MANDA: item com marcas definidas só considera resposta que
  // cotou uma delas. Sem isso o mais barato ganhava mesmo com marca proibida
  // (o arroz Biju ganhava de Camil/Tio João/Tio Urbano) — a restrição existia
  // no cadastro e no formulário, mas o cálculo do vencedor ignorava.
  const aceitasPorItem = new Map<string, string[]>();
  for (const it of itens) {
    const lista = (it.marcasAceitas ?? '')
      .split('|')
      .map(normalizaMarca)
      .filter(Boolean);
    if (lista.length > 0) aceitasPorItem.set(it.id, lista);
  }

  // Agrupa respostas por item, ordenado por preco asc
  const respostasOrdenadasPorItem = new Map<string, typeof respostas>();
  for (const r of respostas) {
    if (r.precoUnitarioNormalizado == null) continue;
    const aceitas = aceitasPorItem.get(r.cotacaoItemId);
    if (aceitas) {
      const marca = normalizaMarca(r.marcaNome);
      // sem marca ou marca fora da lista → nem entra na disputa
      if (!marca || !aceitas.includes(marca)) continue;
    }
    if (!respostasOrdenadasPorItem.has(r.cotacaoItemId))
      respostasOrdenadasPorItem.set(r.cotacaoItemId, []);
    respostasOrdenadasPorItem.get(r.cotacaoItemId)!.push(r);
  }
  for (const arr of respostasOrdenadasPorItem.values()) {
    arr.sort(
      (a, b) =>
        Number(a.precoUnitarioNormalizado) - Number(b.precoUnitarioNormalizado),
    );
  }

  // Estado: itemId -> indice (0 = 1 colocado, 1 = 2, ...)
  const alocacao = new Map<string, number>();
  for (const item of itens) {
    if ((respostasOrdenadasPorItem.get(item.id)?.length ?? 0) > 0) alocacao.set(item.id, 0);
  }

  // Loop: reassign itens de fornecedores abaixo do minimo
  for (let iter = 0; iter < 20; iter++) {
    const totaisPorFornecedor = new Map<string, { total: number; itensIds: string[] }>();
    for (const [itemId, idx] of alocacao) {
      const candidatos = respostasOrdenadasPorItem.get(itemId)!;
      const resp = candidatos[idx];
      const item = itens.find((i) => i.id === itemId)!;
      const fornId = dadosForn.get(resp.cotacaoFornecedorId)!.fornecedorId;
      const total = Number(resp.precoUnitarioNormalizado) * Number(item.quantidade);
      if (!totaisPorFornecedor.has(fornId))
        totaisPorFornecedor.set(fornId, { total: 0, itensIds: [] });
      const acc = totaisPorFornecedor.get(fornId)!;
      acc.total += total;
      acc.itensIds.push(itemId);
    }

    let mudou = false;
    for (const [fornId, { total, itensIds }] of totaisPorFornecedor) {
      const minimo = [...dadosForn.values()].find((d) => d.fornecedorId === fornId)?.minimo;
      if (!minimo || total >= minimo) continue;
      for (const itemId of itensIds) {
        const idxAtual = alocacao.get(itemId)!;
        const candidatos = respostasOrdenadasPorItem.get(itemId)!;
        if (idxAtual + 1 < candidatos.length) alocacao.set(itemId, idxAtual + 1);
        else alocacao.delete(itemId);
      }
      mudou = true;
      break;
    }
    if (!mudou) break;
  }

  // Constroi resultado
  const itensOriginais = new Map<string, { fornecedorId: string; fornecedorNome: string | null }>();
  for (const item of itens) {
    const resps = respostasOrdenadasPorItem.get(item.id) ?? [];
    if (resps[0]) {
      const dados = dadosForn.get(resps[0].cotacaoFornecedorId)!;
      itensOriginais.set(item.id, { fornecedorId: dados.fornecedorId, fornecedorNome: dados.nome });
    }
  }

  const porFornecedorMap = new Map<string, FornecedorAlocacao>();
  const orfaos: ItemOrfao[] = [];
  const reassignados: ResultadoAlocacao['reassignados'] = [];

  for (const item of itens) {
    const idx = alocacao.get(item.id);
    if (idx == null) {
      orfaos.push({
        itemId: item.id,
        produtoId: item.produtoId,
        produtoNome: item.produtoNome,
        qtd: item.quantidade,
        unidade: item.unidade,
        motivo: respostasOrdenadasPorItem.get(item.id)?.length
          ? 'esgotou_colocados'
          : 'sem_resposta',
      });
      continue;
    }
    const candidatos = respostasOrdenadasPorItem.get(item.id)!;
    const resp = candidatos[idx];
    const dados = dadosForn.get(resp.cotacaoFornecedorId)!;
    const preco = Number(resp.precoUnitarioNormalizado);
    const qtdNum = Number(item.quantidade);
    const itemAlocado: ItemAlocado = {
      itemId: item.id,
      produtoId: item.produtoId,
      produtoNome: item.produtoNome,
      qtd: item.quantidade,
      unidade: item.unidade,
      ranque: idx,
      respostaId: resp.id,
      preco,
      precoTotal: preco * qtdNum,
      marcaId: resp.marcaId,
      marcaNome: resp.marcaNome,
      cotacaoFornecedorId: resp.cotacaoFornecedorId,
      fornecedorId: dados.fornecedorId,
      fornecedorNome: dados.nome,
    };
    if (idx > 0) {
      const original = itensOriginais.get(item.id);
      reassignados.push({
        itemId: item.id,
        produtoNome: item.produtoNome,
        ranqueOriginal: 0,
        ranqueFinal: idx,
        fornecedorOriginal: original?.fornecedorNome ?? null,
        fornecedorFinal: dados.nome ?? '?',
      });
    }
    if (!porFornecedorMap.has(dados.fornecedorId)) {
      porFornecedorMap.set(dados.fornecedorId, {
        fornecedorId: dados.fornecedorId,
        fornecedorNome: dados.nome,
        cotacaoFornecedorId: resp.cotacaoFornecedorId,
        itens: [],
        total: 0,
        valorPedidoMinimo: dados.minimo,
        atingeMinimo: true,
      });
    }
    const acc = porFornecedorMap.get(dados.fornecedorId)!;
    acc.itens.push(itemAlocado);
    acc.total += itemAlocado.precoTotal;
  }
  // Calcula atingeMinimo
  for (const f of porFornecedorMap.values()) {
    f.atingeMinimo = !f.valorPedidoMinimo || f.total >= f.valorPedidoMinimo;
  }

  const porFornecedor = [...porFornecedorMap.values()].sort(
    (a, b) => (b.total ?? 0) - (a.total ?? 0),
  );
  const totalGeral = porFornecedor.reduce((acc, f) => acc + f.total, 0);

  return { porFornecedor, orfaos, reassignados, totalGeral };
}
