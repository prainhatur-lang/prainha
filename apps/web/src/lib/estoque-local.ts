// Setores de estoque da casa (Depósito, Recepção, Bar, Cozinha...) e o saldo
// de cada produto em cada setor (02/11/2026).
//
// Regra do saldo (não mexe em nada do estoque que já existe):
//  - O total da casa continua sendo `produto.estoque_atual`.
//  - Setor comum: entra o que foi transferido pra ele, sai o que foi
//    transferido dele e o que foi vendido/usado (venda, ficha técnica,
//    produção, perda — estorno de venda volta) DEPOIS da transferência.
//    A venda sai primeiro dos setores que têm o produto (na ordem do
//    cadastro); o que faltar saiu do setor principal.
//  - Setor principal (Depósito): o total da casa menos o que está nos
//    outros setores. Compra, ajuste e produção caem aqui.
//  Assim a soma dos setores sempre bate com o saldo da casa.
//  - RECEPÇÃO (02/11/2026, a recepção tem bar próprio): o que foi vendido
//    pelo Ticket/Totem (conta "TICKET N") de item marcado "Sai na Recepção"
//    sai primeiro da Recepção. O resto (venda na mesa, comida do ticket) NÃO
//    tira da Recepção — sai dos outros setores e, faltando, do principal.

import { db, schema } from '@concilia/db';
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

export const BUCKET_TRANSF_LOCAL = 'estoque-transferencia-fotos';

export const LOCAIS_PADRAO: { nome: string; principal: boolean }[] = [
  { nome: 'Depósito', principal: true },
  { nome: 'Recepção', principal: false },
  { nome: 'Bar', principal: false },
  { nome: 'Cozinha', principal: false },
];

/** Tipos de movimento que contam como consumo no setor (estorno de venda
 *  com pedido entra com sinal positivo e devolve). */
const TIPOS_CONSUMO = ['SAIDA_VENDA', 'SAIDA_FICHA_TECNICA', 'SAIDA_PRODUCAO', 'PERDA', 'ENTRADA_DEVOLUCAO'];

export type LocalEstoque = {
  id: string;
  nome: string;
  ordem: number;
  principal: boolean;
  ativo: boolean;
};

/** Setores da casa. Na primeira vez cria Depósito/Recepção/Bar/Cozinha. */
export async function locaisDaFilial(filialId: string): Promise<LocalEstoque[]> {
  const ler = () =>
    db
      .select({
        id: schema.estoqueLocal.id,
        nome: schema.estoqueLocal.nome,
        ordem: schema.estoqueLocal.ordem,
        principal: schema.estoqueLocal.principal,
        ativo: schema.estoqueLocal.ativo,
      })
      .from(schema.estoqueLocal)
      .where(eq(schema.estoqueLocal.filialId, filialId))
      .orderBy(asc(schema.estoqueLocal.ordem), asc(schema.estoqueLocal.nome));
  let rows = await ler();
  if (rows.length === 0) {
    await db
      .insert(schema.estoqueLocal)
      .values(LOCAIS_PADRAO.map((l, i) => ({ filialId, nome: l.nome, principal: l.principal, ordem: i + 1 })))
      .onConflictDoNothing();
    rows = await ler();
  }
  return rows;
}

export type SaldoProdutoLocal = {
  produtoId: string;
  nome: string;
  unidade: string;
  total: number;
  /** localId → saldo */
  porLocal: Record<string, number>;
};

/** Saldo de cada produto (que controla estoque) em cada setor. */
export async function saldosPorLocal(filialId: string, locais: LocalEstoque[]): Promise<SaldoProdutoLocal[]> {
  const principal = locais.find((l) => l.principal) ?? locais[0];
  if (!principal) return [];
  const setores = locais.filter((l) => l.id !== principal.id);
  const ordemSetor = new Map(setores.map((l, i) => [l.id, i]));
  const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const recepcao = setores.find((l) => semAcento(l.nome).startsWith('recepcao'))?.id ?? null;

  const produtos = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      unidade: schema.produto.unidadeEstoque,
      estoqueAtual: schema.produto.estoqueAtual,
    })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filialId),
        eq(schema.produto.controlaEstoque, true),
        sql`${schema.produto.tipo} <> 'VENDA_COMPOSTO'`,
        sql`coalesce(${schema.produto.descontinuado}, false) = false`,
      ),
    );

  const transf = await db
    .select({
      produtoId: schema.estoqueTransferenciaLocal.produtoId,
      quantidade: schema.estoqueTransferenciaLocal.quantidade,
      origem: schema.estoqueTransferenciaLocal.localOrigemId,
      destino: schema.estoqueTransferenciaLocal.localDestinoId,
      dataHora: schema.estoqueTransferenciaLocal.dataHora,
    })
    .from(schema.estoqueTransferenciaLocal)
    .where(
      and(
        eq(schema.estoqueTransferenciaLocal.filialId, filialId),
        isNull(schema.estoqueTransferenciaLocal.canceladaEm),
      ),
    )
    .orderBy(asc(schema.estoqueTransferenciaLocal.dataHora));

  // Consumo (por minuto) só dos produtos que já foram transferidos, a partir
  // da primeira transferência de cada um.
  const primeira = new Map<string, Date>();
  for (const t of transf) if (!primeira.has(t.produtoId)) primeira.set(t.produtoId, t.dataHora);
  const ids = [...primeira.keys()];
  type Ev = { t: number; tipo: 'T' | 'C'; q: number; origem?: string; destino?: string; recepcao?: boolean };
  const eventos = new Map<string, Ev[]>();
  for (const t of transf) {
    const arr = eventos.get(t.produtoId) ?? [];
    arr.push({ t: t.dataHora.getTime(), tipo: 'T', q: Number(t.quantidade), origem: t.origem, destino: t.destino });
    eventos.set(t.produtoId, arr);
  }
  if (ids.length > 0) {
    const desde = new Date(Math.min(...[...primeira.values()].map((d) => d.getTime())));
    // venda da recepção: conta "TICKET N" + item marcado "Sai na Recepção"
    const daRecepcao = recepcao
      ? sql<boolean>`EXISTS (SELECT 1 FROM pedido_item pi
          JOIN pedido p ON p.id = pi.pedido_id
          JOIN recepcao_item r ON r.filial_id = pi.filial_id
            AND r.codigo = coalesce(pi.codigo_variante_externo, pi.codigo_produto_externo)
          WHERE pi.id = ${schema.movimentoEstoque.pedidoItemId} AND p.nome_cliente ILIKE 'TICKET %')`
      : sql<boolean>`false`;
    const consumo = await db
      .select({
        produtoId: schema.movimentoEstoque.produtoId,
        minuto: sql<string>`date_trunc('minute', ${schema.movimentoEstoque.dataHora})`,
        recepcao: daRecepcao,
        qtd: sql<string>`sum(${schema.movimentoEstoque.quantidade})`,
      })
      .from(schema.movimentoEstoque)
      .where(
        and(
          eq(schema.movimentoEstoque.filialId, filialId),
          inArray(schema.movimentoEstoque.produtoId, ids),
          inArray(schema.movimentoEstoque.tipo, TIPOS_CONSUMO),
          gte(schema.movimentoEstoque.dataHora, desde),
          // estorno só o de venda (com pedido)
          sql`(${schema.movimentoEstoque.tipo} <> 'ENTRADA_DEVOLUCAO' OR ${schema.movimentoEstoque.pedidoItemId} IS NOT NULL)`,
        ),
      )
      .groupBy(schema.movimentoEstoque.produtoId, sql`date_trunc('minute', ${schema.movimentoEstoque.dataHora})`, sql`3`);
    for (const c of consumo) {
      const t = new Date(c.minuto).getTime();
      const p = primeira.get(c.produtoId);
      if (!p || t < p.getTime() - 60_000) continue;
      // movimento negativo = consumo; positivo (estorno) = devolve
      const q = -Number(c.qtd);
      if (!q) continue;
      eventos.get(c.produtoId)?.push({ t, tipo: 'C', q, recepcao: c.recepcao === true });
    }
  }

  // Simula setor a setor, em ordem de tempo.
  const setorPorProduto = new Map<string, Map<string, number>>();
  for (const [produtoId, evs] of eventos) {
    evs.sort((a, b) => a.t - b.t || (a.tipo === 'T' ? -1 : 1));
    const bal = new Map<string, number>();
    // último setor que perdeu por venda, pra devolver o estorno no mesmo lugar
    let ultimoConsumido: string | null = null;
    for (const e of evs) {
      if (e.tipo === 'T') {
        if (e.origem && e.origem !== principal.id) bal.set(e.origem, (bal.get(e.origem) ?? 0) - e.q);
        if (e.destino && e.destino !== principal.id) bal.set(e.destino, (bal.get(e.destino) ?? 0) + e.q);
        continue;
      }
      if (e.q < 0) {
        if (ultimoConsumido) bal.set(ultimoConsumido, (bal.get(ultimoConsumido) ?? 0) - e.q);
        continue;
      }
      let falta = e.q;
      // venda da recepção: Recepção primeiro; o resto nunca tira da Recepção
      const comSaldo = [...bal.entries()]
        .filter(([loc, v]) => v > 0 && (e.recepcao || loc !== recepcao))
        .sort((a, b) =>
          e.recepcao && (a[0] === recepcao || b[0] === recepcao)
            ? (a[0] === recepcao ? -1 : 1)
            : (ordemSetor.get(a[0]) ?? 99) - (ordemSetor.get(b[0]) ?? 99),
        );
      for (const [loc, v] of comSaldo) {
        if (falta <= 0) break;
        const tira = Math.min(v, falta);
        bal.set(loc, v - tira);
        falta -= tira;
        ultimoConsumido = loc;
      }
    }
    setorPorProduto.set(produtoId, bal);
  }

  const out: SaldoProdutoLocal[] = [];
  for (const p of produtos) {
    const total = Number(p.estoqueAtual ?? 0);
    const bal = setorPorProduto.get(p.id);
    const porLocal: Record<string, number> = {};
    let somaSetores = 0;
    if (bal) {
      for (const [loc, v] of bal) {
        const r = Math.round(v * 1000) / 1000;
        if (r !== 0) {
          porLocal[loc] = r;
          somaSetores += r;
        }
      }
    }
    const noPrincipal = Math.round((total - somaSetores) * 1000) / 1000;
    if (noPrincipal !== 0) porLocal[principal.id] = noPrincipal;
    if (Object.keys(porLocal).length === 0 && total === 0) continue;
    out.push({ produtoId: p.id, nome: p.nome ?? '(sem nome)', unidade: p.unidade, total, porLocal });
  }
  out.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return out;
}

/** Saldo de UM produto em cada setor (pra conferir antes de transferir). */
export async function saldoDoProdutoPorLocal(
  filialId: string,
  produtoId: string,
): Promise<Record<string, number>> {
  const locais = await locaisDaFilial(filialId);
  const todos = await saldosPorLocal(filialId, locais);
  return todos.find((s) => s.produtoId === produtoId)?.porLocal ?? {};
}
