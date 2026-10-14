// Refaz saldo e custo médio de um produto a partir de um movimento corrigido
// (ex.: caixa com 24 que entrou como 1 un). O MPM só guarda o resultado
// (produto.estoque_atual / preco_custo), então pra mudar uma entrada antiga:
//
//   1. VOLTA: parte do estado atual e desfaz, do mais novo pro mais velho, os
//      movimentos aplicados depois do ponto (ordem de criado_em = ordem em que
//      o saldo/custo foram mexidos de verdade; data_hora da compra é a data da
//      nota e pode ser anterior). Guarda o saldo de depois de cada um.
//   2. IDA: reaplica a lista corrigida em cima do estado de partida.
//
// Contagem (ajuste manual que não é "entrada" digitada) fixa o saldo no que
// foi contado: o delta da correção não passa por cima dela — a contagem já
// tinha absorvido o erro (regra de 04/10/2026). AJUSTE_CUSTO fixa o custo.
// Saída não mexe no custo. Sem mudança na lista, a ida devolve o estado atual.

import { schema } from '@concilia/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { calcularMpm, type ExecDb } from '@/lib/custo-medio';

export interface MovRecalc {
  id: string;
  tipo: string;
  quantidade: number;
  precoUnitario: number;
  observacao: string | null;
  /** saldo original logo depois do movimento (preenchido na volta) */
  saldoDepois?: number;
  /** custo médio original logo depois do movimento (preenchido na volta) */
  custoDepois?: number;
}

export interface TrechoCusto {
  produtoId: string;
  saldoAtual: number;
  custoAtual: number;
  /** estado logo antes do ponto */
  saldoAntes: number;
  custoAntes: number;
  /** movimentos do ponto em diante, em ordem de aplicação */
  movs: MovRecalc[];
}

const EPS = 1e-4;

/** Ajuste manual que é contagem (não compra digitada com observação "entrada"). */
export function ehContagem(m: Pick<MovRecalc, 'tipo' | 'observacao'>): boolean {
  if (m.tipo !== 'ENTRADA_AJUSTE' && m.tipo !== 'SAIDA_AJUSTE') return false;
  return (m.observacao ?? '').trim().toLowerCase() !== 'entrada';
}

function entraNaMedia(m: MovRecalc): boolean {
  return m.tipo.startsWith('ENTRADA') && m.quantidade > 0 && m.precoUnitario > 0;
}

/** Lê o produto (travando a linha) e os movimentos dele aplicados do ponto
 *  em diante, e calcula pra trás o estado de partida. */
export async function lerTrechoCusto(
  exec: ExecDb,
  produtoId: string,
  /** id do movimento corrigido: o trecho começa nele (mesmo que hoje ele
   *  seja de outro produto) */
  pontoMovId: string,
): Promise<TrechoCusto> {
  const [prod] = await exec
    .select({
      estoqueAtual: schema.produto.estoqueAtual,
      precoCusto: schema.produto.precoCusto,
    })
    .from(schema.produto)
    .where(eq(schema.produto.id, produtoId))
    .for('update')
    .limit(1);
  if (!prod) throw new Error(`produto ${produtoId} nao encontrado`);

  const rows = await exec
    .select({
      id: schema.movimentoEstoque.id,
      tipo: schema.movimentoEstoque.tipo,
      quantidade: schema.movimentoEstoque.quantidade,
      precoUnitario: schema.movimentoEstoque.precoUnitario,
      observacao: schema.movimentoEstoque.observacao,
    })
    .from(schema.movimentoEstoque)
    .where(
      and(
        eq(schema.movimentoEstoque.produtoId, produtoId),
        // comparação no banco (microssegundos); empate de criado_em desempata pelo id
        sql`(${schema.movimentoEstoque.criadoEm}, ${schema.movimentoEstoque.id}) >= (
          (SELECT m.criado_em FROM movimento_estoque m WHERE m.id = ${pontoMovId}), ${pontoMovId}::uuid)`,
      ),
    )
    .orderBy(asc(schema.movimentoEstoque.criadoEm), asc(schema.movimentoEstoque.id));

  const movs: MovRecalc[] = rows.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      quantidade: Number(r.quantidade ?? 0),
      precoUnitario: Number(r.precoUnitario ?? 0),
      observacao: r.observacao,
    }));

  const saldoAtual = Number(prod.estoqueAtual ?? 0);
  const custoAtual = Number(prod.precoCusto ?? 0);
  let s = saldoAtual;
  let c = custoAtual;
  for (let i = movs.length - 1; i >= 0; i--) {
    const m = movs[i]!;
    m.saldoDepois = s;
    m.custoDepois = c;
    if (m.tipo === 'AJUSTE_CUSTO') {
      // o custo de antes do ajuste não ficou guardado: desconhecido (0 = a
      // próxima entrada define). A ida volta a fixar o custo aqui mesmo.
      c = 0;
      continue;
    }
    const sAntes = s - m.quantidade;
    if (entraNaMedia(m)) {
      // custo depois = preço da entrada → o MPM adotou o preço (custo de antes
      // era 0 ou saldo ≤ 0): o de antes é indeterminado, fica 0 (a ida faz o
      // mesmo). Caso real: Corona com custo zerado (26/09) — a conta de volta
      // devolvia o próprio preço da entrada como custo antigo.
      const igualEntrada = Math.abs(c - m.precoUnitario) <= 1e-4 * Math.max(1, m.precoUnitario);
      const cAntes =
        sAntes > EPS && c > 0 && !igualEntrada ? (s * c - m.quantidade * m.precoUnitario) / sAntes : 0;
      c = Number.isFinite(cAntes) && cAntes > 0 ? cAntes : 0;
    }
    s = sAntes;
  }

  return { produtoId, saldoAtual, custoAtual, saldoAntes: s, custoAntes: c, movs };
}

/** Saídas que gravam o custo do momento (CMV). Transferência, devolução e
 *  produção ficam de fora: o valor delas casa com outro movimento. */
const SAIDAS_CUSTO = new Set(['SAIDA_VENDA', 'SAIDA_FICHA_TECNICA', 'SAIDA_AJUSTE']);

export interface SaidaRecusto {
  id: string;
  quantidade: number;
  precoAntigo: number;
  precoNovo: number;
}

/** Reaplica `movs` (lista já corrigida) em cima do estado de partida.
 *  `saidas`: saídas do trecho que gravaram o custo errado (preço = custo
 *  médio antigo daquele momento) e o custo certo pra regravar. */
export function refazerTrecho(
  partida: { saldoAntes: number; custoAntes: number },
  movs: MovRecalc[],
): { saldo: number; custo: number; saidas: SaidaRecusto[] } {
  let s = partida.saldoAntes;
  let c = partida.custoAntes;
  const saidas: SaidaRecusto[] = [];
  for (const m of movs) {
    if (m.tipo === 'AJUSTE_CUSTO') {
      if (m.precoUnitario > 0) c = m.precoUnitario;
      continue;
    }
    if (SAIDAS_CUSTO.has(m.tipo) && m.custoDepois != null && m.custoDepois > 0) {
      const tol = 1e-4 * Math.max(1, m.custoDepois);
      if (Math.abs(m.precoUnitario - m.custoDepois) <= tol && Math.abs(c - m.precoUnitario) > tol) {
        saidas.push({ id: m.id, quantidade: m.quantidade, precoAntigo: m.precoUnitario, precoNovo: c });
      }
    }
    const contagem = ehContagem(m) && m.saldoDepois != null;
    // contagem: o que entra/sai é o que falta pro número contado
    const q = contagem ? m.saldoDepois! - s : m.quantidade;
    if (m.tipo.startsWith('ENTRADA') && q > 0 && m.precoUnitario > 0) {
      c = calcularMpm({ saldoAtual: s, custoAtual: c, qtdEntrada: q, custoEntrada: m.precoUnitario }).custoNovo;
    }
    s = contagem ? m.saldoDepois! : s + q;
  }
  return { saldo: s, custo: c, saidas };
}

/** Regrava preço e valor das saídas que tinham pegado o custo errado. */
export async function regravarSaidas(exec: ExecDb, saidas: SaidaRecusto[]): Promise<void> {
  for (const sd of saidas) {
    await exec
      .update(schema.movimentoEstoque)
      .set({
        precoUnitario: sd.precoNovo.toFixed(6),
        // sinal do valor como já estava gravado (venda grava positivo)
        valorTotal: sql`CASE WHEN ${schema.movimentoEstoque.valorTotal} < 0 THEN -1 ELSE 1 END * ${(
          Math.abs(sd.quantidade) * sd.precoNovo
        ).toFixed(2)}::numeric`,
      })
      .where(eq(schema.movimentoEstoque.id, sd.id));
  }
}

export async function gravarSaldoCusto(
  exec: ExecDb,
  produtoId: string,
  r: { saldo: number; custo: number },
): Promise<void> {
  await exec
    .update(schema.produto)
    .set({ estoqueAtual: r.saldo.toFixed(4), precoCusto: r.custo.toFixed(4) })
    .where(eq(schema.produto.id, produtoId));
}
