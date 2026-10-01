// Transferência de mercadoria entre casas + encontro de contas mensal.
// Regra do dono (30/09/2026) — ver packages/db/src/schema/transferencia.ts:
//   - sai da origem e entra no destino pelo CUSTO MÉDIO da origem;
//   - o destino fica devendo: 1 conta_pagar no destino (origem='TRANSFERENCIA');
//     o "a receber" da origem é a própria transferência ABERTA;
//   - recebimento com conferência (01/10/2026): a transferência pode nascer
//     ENVIADA (em trânsito) — só sai da origem; a casa que recebe confere os
//     itens e aí entra no estoque dela + nasce a conta (vira ABERTA);
//   - no fim do mês o encontro compensa cada par de casas: baixa as contas por
//     compensação e sobra 1 conta_pagar (origem='ENCONTRO_CONTAS') só com a
//     diferença, na casa que deve — essa é paga de verdade (Pix/TED).

import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { aplicarMpmEntrada, aplicarSaida, desfazerMpmEntrada, type ExecDb } from '@/lib/custo-medio';

export class RecusaTransf extends Error {}

/** 'YYYY-MM' → último dia do mês 'YYYY-MM-DD' */
export function ultimoDiaMes(competencia: string): string {
  const [y, m] = competencia.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m, 0)); // dia 0 do mês seguinte
  return d.toISOString().slice(0, 10);
}

export function compLabel(competencia: string): string {
  const [y, m] = competencia.split('-');
  return `${m}/${y}`;
}

async function filiaisComAcesso(userId: string, ids: string[]): Promise<Set<string>> {
  const rows = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, userId), inArray(schema.usuarioFilial.filialId, ids)));
  return new Set(rows.map((r) => r.filialId));
}

export interface ItemTransfInput {
  produtoOrigemId: string;
  /** null = o produto não existe na casa que recebe: cadastra lá (cópia do
   *  cadastro da origem, só estoque) e grava o de/para. */
  produtoDestinoId: string | null;
  quantidade: number;
  /** Só vale quando o custo médio da origem está zerado (CMV zerado em
   *  26/09/2026) — aí o usuário informa o custo. */
  custoUnitario?: number;
}

type ItemResolvido = ItemTransfInput & { produtoDestinoId: string };

/** Item sem produto no destino: usa o de/para salvo; se não tiver, cadastra
 *  na casa que recebe copiando o cadastro da origem. Nasce como INSUMO da
 *  nuvem (só estoque — não entra no cardápio do PDV, que exige variante). */
async function resolverDestinos(
  tx: ExecDb,
  itens: ItemTransfInput[],
  filialOrigemId: string,
  filialDestinoId: string,
): Promise<ItemResolvido[]> {
  const faltam = [...new Set(itens.filter((i) => !i.produtoDestinoId).map((i) => i.produtoOrigemId))];
  const criados = new Map<string, string>();
  if (faltam.length) {
    const dp = await tx
      .select({ o: schema.produtoDeparaFilial.produtoOrigemId, d: schema.produtoDeparaFilial.produtoDestinoId })
      .from(schema.produtoDeparaFilial)
      .where(
        and(
          inArray(schema.produtoDeparaFilial.produtoOrigemId, faltam),
          eq(schema.produtoDeparaFilial.filialDestinoId, filialDestinoId),
        ),
      );
    for (const r of dp) criados.set(r.o, r.d);
    const origens = await tx
      .select()
      .from(schema.produto)
      .where(and(inArray(schema.produto.id, faltam), eq(schema.produto.filialId, filialOrigemId)));
    for (const po of origens) {
      if (criados.has(po.id)) continue;
      const [novo] = await tx
        .insert(schema.produto)
        .values({
          filialId: filialDestinoId,
          codigoExterno: null,
          nome: po.nome,
          descricao: po.descricao,
          tipo: 'INSUMO',
          unidadeEstoque: po.unidadeEstoque,
          controlaEstoque: true,
          estoqueControlado: true,
          criadoNaNuvem: true,
          descontinuado: false,
          estoqueAtual: '0',
          precoCusto: '0',
          itemPorKg: po.itemPorKg,
          pesoUnitarioPadraoKg: po.pesoUnitarioPadraoKg,
          volumeUnitarioMl: po.volumeUnitarioMl,
          categoriaCompras: po.categoriaCompras,
          descricaoCompra: po.descricaoCompra,
          ncm: po.ncm,
          cest: po.cest,
        })
        .returning({ id: schema.produto.id });
      if (!novo) throw new Error('falha ao cadastrar produto no destino');
      criados.set(po.id, novo.id);
    }
  }
  return itens.map((i) => {
    const d = i.produtoDestinoId ?? criados.get(i.produtoOrigemId);
    if (!d) throw new RecusaTransf('produto de origem não é da casa que envia');
    return { ...i, produtoDestinoId: d };
  });
}

/** Grava o de/para nas duas direções (A→B e B→A): da próxima vez a tela já
 *  acha o produto, mesmo com nome diferente. Escolha nova sobrescreve. */
async function gravarDepara(
  tx: ExecDb,
  itens: ItemResolvido[],
  filialOrigemId: string,
  filialDestinoId: string,
  userId: string,
) {
  const pares = new Map<string, { produtoOrigemId: string; filialDestinoId: string; produtoDestinoId: string }>();
  for (const i of itens) {
    pares.set(`${i.produtoOrigemId}|${filialDestinoId}`, {
      produtoOrigemId: i.produtoOrigemId,
      filialDestinoId,
      produtoDestinoId: i.produtoDestinoId,
    });
    pares.set(`${i.produtoDestinoId}|${filialOrigemId}`, {
      produtoOrigemId: i.produtoDestinoId,
      filialDestinoId: filialOrigemId,
      produtoDestinoId: i.produtoOrigemId,
    });
  }
  const agora = new Date();
  for (const v of pares.values()) {
    await tx
      .insert(schema.produtoDeparaFilial)
      .values({ ...v, atualizadoPor: userId, atualizadoEm: agora })
      .onConflictDoUpdate({
        target: [schema.produtoDeparaFilial.produtoOrigemId, schema.produtoDeparaFilial.filialDestinoId],
        set: { produtoDestinoId: v.produtoDestinoId, atualizadoPor: userId, atualizadoEm: agora },
      });
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Roda dentro da transação de quem chamou (exec) ou abre uma. Passar `exec`
 *  serve pra testar com rollback de verdade — o `db` é Proxy, não dá pra
 *  embrulhar por fora. */
function emTransacao<T>(exec: ExecDb | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return exec ? fn(exec as Tx) : db.transaction(fn);
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const normNome = (s: string | null) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim();
const CNPJ_TESTE = '00000000000000';

// ─── Custo estimado ────────────────────────────────────────────────────────

export interface CustoEstimado {
  custo: number;
  /** de onde veio, pra mostrar na tela ("última compra", "custo médio em Prainha Mar") */
  fonte: string;
}

/** Produto da origem SEM custo médio (CMV zerado em 26/09/2026): estima um
 *  custo pra transferência não ir vazia. Ordem:
 *   1. última compra do próprio produto (ENTRADA_COMPRA com preço);
 *   2. custo médio do mesmo produto em outra casa (de/para, senão nome+unidade);
 *   3. última compra desse mesmo produto na outra casa.
 *  Só devolve quem está sem custo e tem alguma estimativa. */
export async function estimarCustos(
  filialOrigemId: string,
  produtoIds?: string[],
  exec: ExecDb = db,
): Promise<Map<string, CustoEstimado>> {
  const out = new Map<string, CustoEstimado>();
  if (produtoIds && !produtoIds.length) return out;
  const alvo = await exec
    .select({ id: schema.produto.id, nome: schema.produto.nome, unidade: schema.produto.unidadeEstoque })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filialOrigemId),
        sql`COALESCE(${schema.produto.precoCusto}, 0) <= 0`,
        produtoIds ? inArray(schema.produto.id, produtoIds) : eq(schema.produto.controlaEstoque, true),
      ),
    );
  if (!alvo.length) return out;

  const ultimaCompra = async (ids: string[]) => {
    const m = new Map<string, number>();
    if (!ids.length) return m;
    const rows = await exec
      .selectDistinctOn([schema.movimentoEstoque.produtoId], {
        produtoId: schema.movimentoEstoque.produtoId,
        preco: schema.movimentoEstoque.precoUnitario,
      })
      .from(schema.movimentoEstoque)
      .where(
        and(
          inArray(schema.movimentoEstoque.produtoId, ids),
          eq(schema.movimentoEstoque.tipo, 'ENTRADA_COMPRA'),
          gt(schema.movimentoEstoque.precoUnitario, '0'),
        ),
      )
      .orderBy(schema.movimentoEstoque.produtoId, desc(schema.movimentoEstoque.dataHora));
    for (const r of rows) m.set(r.produtoId, Number(r.preco));
    return m;
  };

  const proprias = await ultimaCompra(alvo.map((p) => p.id));
  for (const [id, custo] of proprias) out.set(id, { custo, fonte: 'última compra' });
  const faltam = alvo.filter((p) => !out.has(p.id));
  if (!faltam.length) return out;

  // mesmo produto nas outras casas da organização
  const [fo] = await exec
    .select({ org: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialOrigemId))
    .limit(1);
  if (!fo) return out;
  const outras = (
    await exec
      .select({ id: schema.filial.id, nome: schema.filial.nome, cnpj: schema.filial.cnpj })
      .from(schema.filial)
      .where(eq(schema.filial.organizacaoId, fo.org))
  ).filter((f) => f.id !== filialOrigemId && f.cnpj !== CNPJ_TESTE);
  if (!outras.length) return out;
  const nomeFilial = new Map(outras.map((f) => [f.id, f.nome]));
  const la = await exec
    .select({
      id: schema.produto.id,
      filialId: schema.produto.filialId,
      nome: schema.produto.nome,
      unidade: schema.produto.unidadeEstoque,
      custo: schema.produto.precoCusto,
      descontinuado: schema.produto.descontinuado,
    })
    .from(schema.produto)
    .where(and(inArray(schema.produto.filialId, outras.map((f) => f.id)), eq(schema.produto.controlaEstoque, true)));
  const laPorId = new Map(la.map((p) => [p.id, p]));
  const laPorNome = new Map<string, typeof la>();
  for (const p of la) {
    if (p.descontinuado) continue;
    const k = `${normNome(p.nome)}|${p.unidade}`;
    const a = laPorNome.get(k) ?? [];
    a.push(p);
    laPorNome.set(k, a);
  }
  const dp = await exec
    .select({ o: schema.produtoDeparaFilial.produtoOrigemId, d: schema.produtoDeparaFilial.produtoDestinoId })
    .from(schema.produtoDeparaFilial)
    .where(inArray(schema.produtoDeparaFilial.produtoOrigemId, faltam.map((p) => p.id)));
  const dpPor = new Map<string, string[]>();
  for (const r of dp) dpPor.set(r.o, [...(dpPor.get(r.o) ?? []), r.d]);

  const candidatos = new Map<string, typeof la>();
  for (const p of faltam) {
    const c = [
      ...(dpPor.get(p.id) ?? []).map((id) => laPorId.get(id)).filter((x): x is (typeof la)[number] => !!x && x.unidade === p.unidade),
      ...(laPorNome.get(`${normNome(p.nome)}|${p.unidade}`) ?? []),
    ];
    if (!c.length) continue;
    const comCusto = c.find((x) => Number(x.custo ?? 0) > 0);
    if (comCusto) {
      out.set(p.id, { custo: Number(comCusto.custo), fonte: `custo médio em ${nomeFilial.get(comCusto.filialId) ?? 'outra casa'}` });
    } else {
      candidatos.set(p.id, c);
    }
  }
  if (candidatos.size) {
    const compras = await ultimaCompra([...new Set([...candidatos.values()].flat().map((x) => x.id))]);
    for (const [id, c] of candidatos) {
      const achou = c.find((x) => compras.has(x.id));
      if (achou) {
        out.set(id, { custo: compras.get(achou.id)!, fonte: `última compra em ${nomeFilial.get(achou.filialId) ?? 'outra casa'}` });
      }
    }
  }
  return out;
}

// ─── Transferência ─────────────────────────────────────────────────────────

export async function criarTransferencia(opts: {
  userId: string;
  filialOrigemId: string;
  filialDestinoId: string;
  data: string;
  notaCompraId?: string | null;
  observacao?: string | null;
  itens: ItemTransfInput[];
  /** true (padrão, o jeito de sempre): entra no estoque do destino e gera a
   *  conta na hora. false: fica ENVIADA (em trânsito) — só sai da origem; a
   *  casa que recebe confere e aí entra no estoque (receberTransferencia). */
  entradaImediata?: boolean;
  exec?: ExecDb;
}) {
  const { userId, filialOrigemId, filialDestinoId, data } = opts;
  const imediata = opts.entradaImediata ?? true;
  if (filialOrigemId === filialDestinoId) throw new RecusaTransf('origem e destino são a mesma casa');
  if (!opts.itens.length) throw new RecusaTransf('nenhum item');
  const acesso = await filiaisComAcesso(userId, [filialOrigemId, filialDestinoId]);
  if (!acesso.has(filialOrigemId)) throw new RecusaTransf('sem acesso à casa que envia');
  const casas = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome, org: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(inArray(schema.filial.id, [filialOrigemId, filialDestinoId]));
  const fOrig = casas.find((f) => f.id === filialOrigemId);
  const fDest = casas.find((f) => f.id === filialDestinoId);
  if (!fOrig || !fDest) throw new RecusaTransf('casa não encontrada');
  if (!acesso.has(filialDestinoId)) {
    // Quem só tem a casa que envia pode mandar pra outra casa da MESMA
    // organização, mas não dá entrada lá: fica pra conferência de quem recebe.
    if (fOrig.org !== fDest.org) throw new RecusaTransf('sem acesso a uma das casas');
    if (imediata) {
      throw new RecusaTransf(`você não tem acesso a ${fDest.nome} — envie pra conferência (a casa que recebe dá a entrada)`);
    }
  }
  const competencia = data.slice(0, 7);

  return emTransacao(opts.exec, async (tx) => {
    const itens = await resolverDestinos(tx, opts.itens, filialOrigemId, filialDestinoId);
    const ids = [...new Set(itens.flatMap((i) => [i.produtoOrigemId, i.produtoDestinoId]))];
    const prods = await tx
      .select({
        id: schema.produto.id,
        filialId: schema.produto.filialId,
        nome: schema.produto.nome,
        precoCusto: schema.produto.precoCusto,
      })
      .from(schema.produto)
      .where(inArray(schema.produto.id, ids))
      .for('update');
    const porId = new Map(prods.map((p) => [p.id, p]));

    // Sem custo médio na origem e sem custo informado: usa a estimativa
    const semCusto = itens
      .filter((i) => Number(porId.get(i.produtoOrigemId)?.precoCusto ?? 0) <= 0 && !(i.custoUnitario && i.custoUnitario > 0))
      .map((i) => i.produtoOrigemId);
    const estimados = semCusto.length ? await estimarCustos(filialOrigemId, semCusto, tx) : new Map<string, CustoEstimado>();

    const linhas: Array<{
      it: ItemResolvido;
      nome: string;
      custo: number;
      valor: number;
      estimado: boolean;
    }> = [];
    for (const it of itens) {
      const po = porId.get(it.produtoOrigemId);
      const pd = porId.get(it.produtoDestinoId);
      if (!po || po.filialId !== filialOrigemId) throw new RecusaTransf('produto de origem não é da casa que envia');
      if (!pd || pd.filialId !== filialDestinoId) throw new RecusaTransf(`"${po.nome}": produto de destino não é da casa que recebe`);
      if (!(it.quantidade > 0)) throw new RecusaTransf(`"${po.nome}": quantidade inválida`);
      let custo = Number(po.precoCusto ?? 0);
      let estimado = false;
      if (custo <= 0) {
        estimado = true;
        if (it.custoUnitario && it.custoUnitario > 0) custo = it.custoUnitario;
        else custo = estimados.get(it.produtoOrigemId)?.custo ?? 0;
        if (!(custo > 0)) {
          throw new RecusaTransf(`"${po.nome}" está sem custo médio na origem e sem compra pra estimar — informe o custo`);
        }
      }
      linhas.push({ it, nome: po.nome ?? '', custo, valor: r2(it.quantidade * custo), estimado });
    }
    const valorTotal = linhas.reduce((s, l) => s + l.valor, 0);

    const [transf] = await tx
      .insert(schema.transferenciaFilial)
      .values({
        filialOrigemId,
        filialDestinoId,
        data,
        competencia,
        valorTotal: valorTotal.toFixed(2),
        notaCompraId: opts.notaCompraId ?? null,
        observacao: opts.observacao?.trim() || null,
        status: imediata ? 'ABERTA' : 'ENVIADA',
        criadoPor: userId,
        ...(imediata ? { recebidaEm: new Date(), recebidaPor: userId } : {}),
      })
      .returning({ id: schema.transferenciaFilial.id, numero: schema.transferenciaFilial.numero });
    if (!transf) throw new Error('falha ao criar transferência');

    const agora = new Date();
    const obs = `Transferência #${transf.numero}`;
    for (const l of linhas) {
      const q = l.it.quantidade;
      const [mS] = await tx
        .insert(schema.movimentoEstoque)
        .values({
          filialId: filialOrigemId,
          produtoId: l.it.produtoOrigemId,
          tipo: 'SAIDA_TRANSFERENCIA',
          quantidade: (-q).toFixed(4),
          precoUnitario: l.custo.toFixed(6),
          valorTotal: l.valor.toFixed(2),
          dataHora: agora,
          observacao: imediata ? obs : `${obs} (pra ${fDest.nome})`,
          criadoPor: userId,
        })
        .returning({ id: schema.movimentoEstoque.id });
      await aplicarSaida({ produtoId: l.it.produtoOrigemId, qtdSaida: q, exec: tx });

      let movEntradaId: string | null = null;
      if (imediata) {
        const [mE] = await tx
          .insert(schema.movimentoEstoque)
          .values({
            filialId: filialDestinoId,
            produtoId: l.it.produtoDestinoId,
            tipo: 'ENTRADA_TRANSFERENCIA',
            quantidade: q.toFixed(4),
            precoUnitario: l.custo.toFixed(6),
            valorTotal: l.valor.toFixed(2),
            dataHora: agora,
            observacao: `${obs} (de ${fOrig.nome ?? 'outra casa'})`,
            criadoPor: userId,
          })
          .returning({ id: schema.movimentoEstoque.id });
        await aplicarMpmEntrada({ produtoId: l.it.produtoDestinoId, qtdEntrada: q, custoEntrada: l.custo, exec: tx });
        movEntradaId = mE?.id ?? null;
      }

      await tx.insert(schema.transferenciaFilialItem).values({
        transferenciaId: transf.id,
        produtoOrigemId: l.it.produtoOrigemId,
        produtoDestinoId: l.it.produtoDestinoId,
        descricao: l.nome,
        quantidade: q.toFixed(4),
        custoUnitario: l.custo.toFixed(6),
        valorTotal: l.valor.toFixed(2),
        movSaidaId: mS?.id ?? null,
        movEntradaId,
        quantidadeRecebida: imediata ? q.toFixed(4) : null,
        custoEstimado: l.estimado,
      });
    }

    if (imediata) {
      const [conta] = await tx
        .insert(schema.contaPagar)
        .values({
          filialId: filialDestinoId,
          dataVencimento: ultimoDiaMes(competencia),
          valor: valorTotal.toFixed(2),
          competencia,
          descricao: `Transferência #${transf.numero} de ${fOrig.nome ?? 'outra casa'}`,
          observacao: 'Compensa no encontro de contas do mês',
          origem: 'TRANSFERENCIA',
          parcela: 1,
          totalParcelas: 1,
          dataCadastro: agora,
        })
        .returning({ id: schema.contaPagar.id });

      await tx
        .update(schema.transferenciaFilial)
        .set({ contaPagarId: conta?.id ?? null })
        .where(eq(schema.transferenciaFilial.id, transf.id));
    }

    await gravarDepara(tx, itens, filialOrigemId, filialDestinoId, userId);

    return {
      id: transf.id,
      numero: transf.numero,
      valorTotal,
      status: imediata ? ('ABERTA' as const) : ('ENVIADA' as const),
    };
  });
}

/** A casa que recebe conferiu a mercadoria: dá entrada no estoque dela (MPM
 *  pelo custo da transferência), gera a conta a pagar pelo que chegou e a
 *  transferência vira ABERTA (entra no encontro do mês do recebimento). O que
 *  não chegou volta pro estoque de quem enviou. */
export async function receberTransferencia(opts: {
  id: string;
  userId: string;
  /** dia do recebimento (BRT) */
  data: string;
  /** itens fora da lista = recebeu a quantidade enviada */
  itens?: Array<{ itemId: string; quantidadeRecebida: number }>;
  observacao?: string | null;
  exec?: ExecDb;
}) {
  const { id, userId, data } = opts;
  return emTransacao(opts.exec, async (tx) => {
    const [t] = await tx
      .select()
      .from(schema.transferenciaFilial)
      .where(eq(schema.transferenciaFilial.id, id))
      .for('update')
      .limit(1);
    if (!t) throw new RecusaTransf('transferência não encontrada');
    const acesso = await filiaisComAcesso(userId, [t.filialDestinoId]);
    if (!acesso.has(t.filialDestinoId)) throw new RecusaTransf('só a casa que recebe confere a transferência');
    if (t.status !== 'ENVIADA') {
      throw new RecusaTransf(t.status === 'ABERTA' ? 'essa transferência já foi recebida' : `transferência já está ${t.status.toLowerCase()}`);
    }
    const [fOrig] = await tx
      .select({ nome: schema.filial.nome })
      .from(schema.filial)
      .where(eq(schema.filial.id, t.filialOrigemId))
      .limit(1);

    const itens = await tx
      .select()
      .from(schema.transferenciaFilialItem)
      .where(eq(schema.transferenciaFilialItem.transferenciaId, id));
    const informado = new Map((opts.itens ?? []).map((i) => [i.itemId, i.quantidadeRecebida]));
    for (const k of informado.keys()) {
      if (!itens.some((i) => i.id === k)) throw new RecusaTransf('item não é dessa transferência');
    }
    await tx
      .select({ id: schema.produto.id })
      .from(schema.produto)
      .where(inArray(schema.produto.id, [...new Set(itens.flatMap((i) => [i.produtoOrigemId, i.produtoDestinoId]))]))
      .for('update');

    const linhas = itens.map((it) => {
      const q = Number(it.quantidade);
      const qr = informado.has(it.id) ? Number(informado.get(it.id)) : q;
      if (!(qr >= 0) || qr > q + 0.00005) {
        throw new RecusaTransf(`"${it.descricao}": recebido tem que ficar entre 0 e ${q} (o que foi enviado)`);
      }
      return { it, q, qr: Math.min(qr, q), c: Number(it.custoUnitario) };
    });
    if (!linhas.some((l) => l.qr > 0)) {
      throw new RecusaTransf('nada recebido — use "Recusar" pra devolver tudo pra casa que enviou');
    }

    const agora = new Date();
    const competencia = data.slice(0, 7);
    const obs = `Transferência #${t.numero}`;
    let valorTotal = 0;
    for (const l of linhas) {
      const valor = r2(l.qr * l.c);
      valorTotal += valor;
      let movEntradaId: string | null = null;
      if (l.qr > 0) {
        const [mE] = await tx
          .insert(schema.movimentoEstoque)
          .values({
            filialId: t.filialDestinoId,
            produtoId: l.it.produtoDestinoId,
            tipo: 'ENTRADA_TRANSFERENCIA',
            quantidade: l.qr.toFixed(4),
            precoUnitario: l.c.toFixed(6),
            valorTotal: valor.toFixed(2),
            dataHora: agora,
            observacao: `${obs} (de ${fOrig?.nome ?? 'outra casa'}) — conferida no recebimento`,
            criadoPor: userId,
          })
          .returning({ id: schema.movimentoEstoque.id });
        await aplicarMpmEntrada({ produtoId: l.it.produtoDestinoId, qtdEntrada: l.qr, custoEntrada: l.c, exec: tx });
        movEntradaId = mE?.id ?? null;
      }
      const falta = Math.round((l.q - l.qr) * 10000) / 10000;
      if (falta > 0) {
        // não chegou: volta pra origem ao mesmo custo que saiu
        await tx.insert(schema.movimentoEstoque).values({
          filialId: t.filialOrigemId,
          produtoId: l.it.produtoOrigemId,
          tipo: 'ENTRADA_DEVOLUCAO',
          quantidade: falta.toFixed(4),
          precoUnitario: l.c.toFixed(6),
          valorTotal: r2(falta * l.c).toFixed(2),
          dataHora: agora,
          movimentoPaiId: l.it.movSaidaId,
          observacao: `${obs}: divergência no recebimento (enviado ${l.q}, recebido ${l.qr})`,
          criadoPor: userId,
        });
        await aplicarMpmEntrada({ produtoId: l.it.produtoOrigemId, qtdEntrada: falta, custoEntrada: l.c, exec: tx });
      }
      await tx
        .update(schema.transferenciaFilialItem)
        .set({ quantidadeRecebida: l.qr.toFixed(4), valorTotal: valor.toFixed(2), movEntradaId })
        .where(eq(schema.transferenciaFilialItem.id, l.it.id));
    }
    valorTotal = r2(valorTotal);

    const [conta] = await tx
      .insert(schema.contaPagar)
      .values({
        filialId: t.filialDestinoId,
        dataVencimento: ultimoDiaMes(competencia),
        valor: valorTotal.toFixed(2),
        competencia,
        descricao: `Transferência #${t.numero} de ${fOrig?.nome ?? 'outra casa'}`,
        observacao: 'Compensa no encontro de contas do mês',
        origem: 'TRANSFERENCIA',
        parcela: 1,
        totalParcelas: 1,
        dataCadastro: agora,
      })
      .returning({ id: schema.contaPagar.id });

    await tx
      .update(schema.transferenciaFilial)
      .set({
        status: 'ABERTA',
        valorTotal: valorTotal.toFixed(2),
        competencia,
        contaPagarId: conta?.id ?? null,
        recebidaEm: agora,
        recebidaPor: userId,
        observacaoRecebimento: opts.observacao?.trim() || null,
      })
      .where(eq(schema.transferenciaFilial.id, id));

    const divergencias = linhas.filter((l) => l.qr < l.q).length;
    return { id, numero: t.numero, valorTotal, divergencias };
  });
}

/** ABERTA (antes do encontro): devolve pra origem e tira do destino.
 *  ENVIADA (em trânsito — cancelar de quem enviou ou recusar de quem ia
 *  receber): só devolve pra origem, o destino nunca chegou a receber. */
export async function cancelarTransferencia(opts: { id: string; userId: string; exec?: ExecDb }) {
  const { id, userId } = opts;
  return emTransacao(opts.exec, async (tx) => {
    const [t] = await tx
      .select()
      .from(schema.transferenciaFilial)
      .where(eq(schema.transferenciaFilial.id, id))
      .for('update')
      .limit(1);
    if (!t) throw new RecusaTransf('transferência não encontrada');
    const acesso = await filiaisComAcesso(userId, [t.filialOrigemId, t.filialDestinoId]);
    const emTransito = t.status === 'ENVIADA';
    if (emTransito) {
      if (!acesso.has(t.filialOrigemId) && !acesso.has(t.filialDestinoId)) {
        throw new RecusaTransf('sem acesso a essa transferência');
      }
    } else {
      if (!acesso.has(t.filialOrigemId) || !acesso.has(t.filialDestinoId)) {
        throw new RecusaTransf('sem acesso a uma das casas');
      }
      if (t.status !== 'ABERTA') throw new RecusaTransf(`transferência já está ${t.status.toLowerCase()}`);
    }
    if (t.contaPagarId) {
      const baixas = await tx
        .select({ id: schema.contaPagarBaixa.id })
        .from(schema.contaPagarBaixa)
        .where(eq(schema.contaPagarBaixa.contaPagarId, t.contaPagarId))
        .limit(1);
      if (baixas.length) throw new RecusaTransf('a conta a pagar dela já tem baixa — estorne a baixa antes');
    }

    const itens = await tx
      .select()
      .from(schema.transferenciaFilialItem)
      .where(eq(schema.transferenciaFilialItem.transferenciaId, id));
    const agora = new Date();
    const obs = emTransito
      ? `Estorno: transferência #${t.numero} cancelada antes do recebimento`
      : `Estorno: transferência #${t.numero} cancelada`;
    for (const it of itens) {
      // ABERTA: o que o destino recebeu (a diferença já voltou na conferência).
      // ENVIADA: tudo que saiu.
      const q = emTransito ? Number(it.quantidade) : Number(it.quantidadeRecebida ?? it.quantidade);
      const c = Number(it.custoUnitario);
      if (!(q > 0)) continue;
      const valor = r2(q * c).toFixed(2);
      // volta pra origem ao mesmo custo que saiu
      await tx.insert(schema.movimentoEstoque).values({
        filialId: t.filialOrigemId,
        produtoId: it.produtoOrigemId,
        tipo: 'ENTRADA_DEVOLUCAO',
        quantidade: q.toFixed(4),
        precoUnitario: c.toFixed(6),
        valorTotal: valor,
        dataHora: agora,
        movimentoPaiId: it.movSaidaId,
        observacao: obs,
        criadoPor: userId,
      });
      await aplicarMpmEntrada({ produtoId: it.produtoOrigemId, qtdEntrada: q, custoEntrada: c, exec: tx });
      if (emTransito) continue;
      // sai do destino e tira da média
      await tx.insert(schema.movimentoEstoque).values({
        filialId: t.filialDestinoId,
        produtoId: it.produtoDestinoId,
        tipo: 'SAIDA_DEVOLUCAO',
        quantidade: (-q).toFixed(4),
        precoUnitario: c.toFixed(6),
        valorTotal: valor,
        dataHora: agora,
        movimentoPaiId: it.movEntradaId,
        observacao: obs,
        criadoPor: userId,
      });
      await desfazerMpmEntrada({ produtoId: it.produtoDestinoId, qtdEntrada: q, custoEntrada: c, exec: tx });
    }

    if (t.contaPagarId) {
      await tx
        .update(schema.contaPagar)
        .set({ dataDelete: agora })
        .where(eq(schema.contaPagar.id, t.contaPagarId));
    }
    await tx
      .update(schema.transferenciaFilial)
      .set({ status: 'CANCELADA', canceladoPor: userId, canceladoEm: agora })
      .where(eq(schema.transferenciaFilial.id, id));
    return { id, numero: t.numero };
  });
}

// ─── Encontro de contas ────────────────────────────────────────────────────

export interface ParEncontro {
  /** a < b (ordem estável por id) */
  a: string;
  b: string;
  /** o que B recebeu de A e ainda não foi compensado (B deve pra A) */
  bDeveA: number;
  aDeveB: number;
  transferencias: string[];
  /** quem paga a diferença (null = empatou) */
  devedora: string | null;
  credora: string | null;
  liquido: number;
}

/** Saldo em aberto (valor − baixas) de cada conta_pagar. */
async function saldosContas(exec: ExecDb, contaIds: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!contaIds.length) return m;
  const contas = await exec
    .select({ id: schema.contaPagar.id, valor: schema.contaPagar.valor, dataDelete: schema.contaPagar.dataDelete })
    .from(schema.contaPagar)
    .where(inArray(schema.contaPagar.id, contaIds));
  const baixas = await exec
    .select({ contaPagarId: schema.contaPagarBaixa.contaPagarId, valor: schema.contaPagarBaixa.valor })
    .from(schema.contaPagarBaixa)
    .where(inArray(schema.contaPagarBaixa.contaPagarId, contaIds));
  const pago = new Map<string, number>();
  for (const b of baixas) pago.set(b.contaPagarId, (pago.get(b.contaPagarId) ?? 0) + Number(b.valor));
  for (const c of contas) {
    if (c.dataDelete) continue;
    m.set(c.id, Math.max(0, Math.round((Number(c.valor) - (pago.get(c.id) ?? 0)) * 100) / 100));
  }
  return m;
}

/** Monta os pares de casas com transferências ABERTAS na competência.
 *  Só entra par em que o usuário tem acesso às duas casas. */
export async function previaEncontro(
  userId: string,
  competencia: string,
  exec: ExecDb = db,
): Promise<ParEncontro[]> {
  const abertas = await exec
    .select({
      id: schema.transferenciaFilial.id,
      origem: schema.transferenciaFilial.filialOrigemId,
      destino: schema.transferenciaFilial.filialDestinoId,
      contaPagarId: schema.transferenciaFilial.contaPagarId,
      valorTotal: schema.transferenciaFilial.valorTotal,
    })
    .from(schema.transferenciaFilial)
    .where(
      and(
        eq(schema.transferenciaFilial.competencia, competencia),
        eq(schema.transferenciaFilial.status, 'ABERTA'),
      ),
    );
  if (!abertas.length) return [];
  const acesso = await filiaisComAcesso(userId, [...new Set(abertas.flatMap((t) => [t.origem, t.destino]))]);
  const saldos = await saldosContas(
    exec,
    abertas.map((t) => t.contaPagarId).filter((x): x is string => !!x),
  );

  const pares = new Map<string, ParEncontro>();
  for (const t of abertas) {
    if (!acesso.has(t.origem) || !acesso.has(t.destino)) continue;
    const [a, b] = t.origem < t.destino ? [t.origem, t.destino] : [t.destino, t.origem];
    const k = `${a}|${b}`;
    const p =
      pares.get(k) ??
      ({ a, b, bDeveA: 0, aDeveB: 0, transferencias: [], devedora: null, credora: null, liquido: 0 } as ParEncontro);
    const saldo = t.contaPagarId ? (saldos.get(t.contaPagarId) ?? 0) : Number(t.valorTotal);
    // destino deve pra origem
    if (t.destino === b) p.bDeveA += saldo;
    else p.aDeveB += saldo;
    p.transferencias.push(t.id);
    pares.set(k, p);
  }
  for (const p of pares.values()) {
    p.bDeveA = Math.round(p.bDeveA * 100) / 100;
    p.aDeveB = Math.round(p.aDeveB * 100) / 100;
    const d = Math.round((p.bDeveA - p.aDeveB) * 100) / 100;
    p.liquido = Math.abs(d);
    if (d > 0) {
      p.devedora = p.b;
      p.credora = p.a;
    } else if (d < 0) {
      p.devedora = p.a;
      p.credora = p.b;
    }
  }
  return [...pares.values()];
}

/** Fecha o encontro da competência pra todos os pares visíveis ao usuário. */
export async function fecharEncontro(opts: {
  userId: string;
  competencia: string;
  data: string;
  /** vencimento da conta da diferença (default = data) */
  vencimento?: string;
}) {
  const { userId, competencia, data } = opts;
  const vencimento = opts.vencimento ?? data;
  const nomes = new Map(
    (await db.select({ id: schema.filial.id, nome: schema.filial.nome }).from(schema.filial)).map((f) => [f.id, f.nome]),
  );

  return db.transaction(async (tx) => {
    // trava as transferências abertas da competência
    await tx
      .select({ id: schema.transferenciaFilial.id })
      .from(schema.transferenciaFilial)
      .where(
        and(
          eq(schema.transferenciaFilial.competencia, competencia),
          eq(schema.transferenciaFilial.status, 'ABERTA'),
        ),
      )
      .for('update');
    const pares = await previaEncontro(userId, competencia, tx);
    if (!pares.length) throw new RecusaTransf('nenhuma transferência em aberto nessa competência');

    const agora = new Date();
    const resultado: Array<{ devedora: string; credora: string; liquido: number; contaPagarId: string | null }> = [];
    for (const p of pares) {
      const devedora = p.devedora ?? p.b;
      const credora = p.credora ?? p.a;

      let contaPagarId: string | null = null;
      if (p.liquido > 0.004) {
        const [c] = await tx
          .insert(schema.contaPagar)
          .values({
            filialId: devedora,
            dataVencimento: vencimento,
            valor: p.liquido.toFixed(2),
            competencia,
            descricao: `Encontro de contas ${compLabel(competencia)} — pagar ${nomes.get(credora) ?? 'outra casa'}`,
            observacao: `${nomes.get(devedora)} recebeu R$ ${(devedora === p.b ? p.bDeveA : p.aDeveB).toFixed(2)} e enviou R$ ${(devedora === p.b ? p.aDeveB : p.bDeveA).toFixed(2)} em transferências`,
            origem: 'ENCONTRO_CONTAS',
            parcela: 1,
            totalParcelas: 1,
            dataCadastro: agora,
          })
          .returning({ id: schema.contaPagar.id });
        contaPagarId = c?.id ?? null;
      }

      const [enc] = await tx
        .insert(schema.encontroContas)
        .values({
          competencia,
          filialDevedoraId: devedora,
          filialCredoraId: credora,
          valorDevedora: (devedora === p.b ? p.bDeveA : p.aDeveB).toFixed(2),
          valorCredora: (devedora === p.b ? p.aDeveB : p.bDeveA).toFixed(2),
          valorLiquido: p.liquido.toFixed(2),
          contaPagarId,
          data,
          criadoPor: userId,
        })
        .returning({ id: schema.encontroContas.id });

      // baixa por compensação em cada conta de transferência do par
      const ts = await tx
        .select({
          id: schema.transferenciaFilial.id,
          contaPagarId: schema.transferenciaFilial.contaPagarId,
        })
        .from(schema.transferenciaFilial)
        .where(inArray(schema.transferenciaFilial.id, p.transferencias));
      const contaIds = ts.map((t) => t.contaPagarId).filter((x): x is string => !!x);
      const saldos = await saldosContas(tx, contaIds);
      const contas = contaIds.length
        ? await tx
            .select({ id: schema.contaPagar.id, filialId: schema.contaPagar.filialId, valor: schema.contaPagar.valor })
            .from(schema.contaPagar)
            .where(and(inArray(schema.contaPagar.id, contaIds), isNull(schema.contaPagar.dataDelete)))
        : [];
      for (const c of contas) {
        const saldo = saldos.get(c.id) ?? 0;
        if (saldo > 0.004) {
          await tx.insert(schema.contaPagarBaixa).values({
            filialId: c.filialId,
            contaPagarId: c.id,
            data,
            valor: saldo.toFixed(2),
            observacao: `Compensação — encontro de contas ${compLabel(competencia)}`,
            criadoPor: userId,
          });
        }
        await recalcularAgregado(tx, c.id, Number(c.valor));
      }

      await tx
        .update(schema.transferenciaFilial)
        .set({ status: 'COMPENSADA', encontroId: enc?.id ?? null })
        .where(inArray(schema.transferenciaFilial.id, p.transferencias));

      resultado.push({ devedora, credora, liquido: p.liquido, contaPagarId });
    }
    return resultado;
  });
}

/** Mesmo cálculo de api/financeiro/contas/[id]/baixas (valor_pago = principal
 *  + juros; quita quando o principal cobre o valor). */
async function recalcularAgregado(exec: ExecDb, contaId: string, valorConta: number) {
  const baixas = await exec
    .select({
      data: schema.contaPagarBaixa.data,
      valor: schema.contaPagarBaixa.valor,
      juros: schema.contaPagarBaixa.juros,
    })
    .from(schema.contaPagarBaixa)
    .where(eq(schema.contaPagarBaixa.contaPagarId, contaId))
    .orderBy(asc(schema.contaPagarBaixa.data));
  const principal = baixas.reduce((s, x) => s + Number(x.valor), 0);
  const juros = baixas.reduce((s, x) => s + Number(x.juros ?? 0), 0);
  const quitada = principal >= valorConta - 0.005;
  await exec
    .update(schema.contaPagar)
    .set({
      valorPago: principal + juros > 0 ? (principal + juros).toFixed(2) : null,
      jurosMulta: juros > 0 ? juros.toFixed(2) : null,
      dataPagamento: quitada && baixas.length > 0 ? baixas[baixas.length - 1]!.data : null,
    })
    .where(eq(schema.contaPagar.id, contaId));
}
