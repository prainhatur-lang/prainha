// Transferência de mercadoria entre casas + encontro de contas mensal.
// Regra do dono (30/09/2026) — ver packages/db/src/schema/transferencia.ts:
//   - sai da origem e entra no destino pelo CUSTO MÉDIO da origem;
//   - o destino fica devendo: 1 conta_pagar no destino (origem='TRANSFERENCIA');
//     o "a receber" da origem é a própria transferência ABERTA;
//   - no fim do mês o encontro compensa cada par de casas: baixa as contas por
//     compensação e sobra 1 conta_pagar (origem='ENCONTRO_CONTAS') só com a
//     diferença, na casa que deve — essa é paga de verdade (Pix/TED).

import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
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
  produtoDestinoId: string;
  quantidade: number;
  /** Só vale quando o custo médio da origem está zerado (CMV zerado em
   *  26/09/2026) — aí o usuário informa o custo. */
  custoUnitario?: number;
}

export async function criarTransferencia(opts: {
  userId: string;
  filialOrigemId: string;
  filialDestinoId: string;
  data: string;
  notaCompraId?: string | null;
  observacao?: string | null;
  itens: ItemTransfInput[];
}) {
  const { userId, filialOrigemId, filialDestinoId, data } = opts;
  if (filialOrigemId === filialDestinoId) throw new RecusaTransf('origem e destino são a mesma casa');
  if (!opts.itens.length) throw new RecusaTransf('nenhum item');
  const acesso = await filiaisComAcesso(userId, [filialOrigemId, filialDestinoId]);
  if (!acesso.has(filialOrigemId) || !acesso.has(filialDestinoId)) {
    throw new RecusaTransf('sem acesso a uma das casas');
  }
  const competencia = data.slice(0, 7);

  const [fOrig] = await db
    .select({ nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialOrigemId))
    .limit(1);

  return db.transaction(async (tx) => {
    const ids = [...new Set(opts.itens.flatMap((i) => [i.produtoOrigemId, i.produtoDestinoId]))];
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

    const linhas: Array<{
      it: ItemTransfInput;
      nome: string;
      custo: number;
      valor: number;
    }> = [];
    for (const it of opts.itens) {
      const po = porId.get(it.produtoOrigemId);
      const pd = porId.get(it.produtoDestinoId);
      if (!po || po.filialId !== filialOrigemId) throw new RecusaTransf('produto de origem não é da casa que envia');
      if (!pd || pd.filialId !== filialDestinoId) throw new RecusaTransf(`"${po.nome}": produto de destino não é da casa que recebe`);
      if (!(it.quantidade > 0)) throw new RecusaTransf(`"${po.nome}": quantidade inválida`);
      let custo = Number(po.precoCusto ?? 0);
      if (custo <= 0) {
        if (!(it.custoUnitario && it.custoUnitario > 0)) {
          throw new RecusaTransf(`"${po.nome}" está sem custo médio na origem — informe o custo`);
        }
        custo = it.custoUnitario;
      }
      linhas.push({ it, nome: po.nome ?? '', custo, valor: Math.round(it.quantidade * custo * 100) / 100 });
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
        criadoPor: userId,
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
          observacao: obs,
          criadoPor: userId,
        })
        .returning({ id: schema.movimentoEstoque.id });
      await aplicarSaida({ produtoId: l.it.produtoOrigemId, qtdSaida: q, exec: tx });

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
          observacao: `${obs} (de ${fOrig?.nome ?? 'outra casa'})`,
          criadoPor: userId,
        })
        .returning({ id: schema.movimentoEstoque.id });
      await aplicarMpmEntrada({ produtoId: l.it.produtoDestinoId, qtdEntrada: q, custoEntrada: l.custo, exec: tx });

      await tx.insert(schema.transferenciaFilialItem).values({
        transferenciaId: transf.id,
        produtoOrigemId: l.it.produtoOrigemId,
        produtoDestinoId: l.it.produtoDestinoId,
        descricao: l.nome,
        quantidade: q.toFixed(4),
        custoUnitario: l.custo.toFixed(6),
        valorTotal: l.valor.toFixed(2),
        movSaidaId: mS?.id ?? null,
        movEntradaId: mE?.id ?? null,
      });
    }

    const [conta] = await tx
      .insert(schema.contaPagar)
      .values({
        filialId: filialDestinoId,
        dataVencimento: ultimoDiaMes(competencia),
        valor: valorTotal.toFixed(2),
        competencia,
        descricao: `Transferência #${transf.numero} de ${fOrig?.nome ?? 'outra casa'}`,
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

    return { id: transf.id, numero: transf.numero, valorTotal };
  });
}

export async function cancelarTransferencia(opts: { id: string; userId: string }) {
  const { id, userId } = opts;
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(schema.transferenciaFilial)
      .where(eq(schema.transferenciaFilial.id, id))
      .for('update')
      .limit(1);
    if (!t) throw new RecusaTransf('transferência não encontrada');
    const acesso = await filiaisComAcesso(userId, [t.filialOrigemId, t.filialDestinoId]);
    if (!acesso.has(t.filialOrigemId) || !acesso.has(t.filialDestinoId)) {
      throw new RecusaTransf('sem acesso a uma das casas');
    }
    if (t.status !== 'ABERTA') throw new RecusaTransf(`transferência já está ${t.status.toLowerCase()}`);
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
    const obs = `Estorno: transferência #${t.numero} cancelada`;
    for (const it of itens) {
      const q = Number(it.quantidade);
      const c = Number(it.custoUnitario);
      // volta pra origem ao mesmo custo que saiu
      await tx.insert(schema.movimentoEstoque).values({
        filialId: t.filialOrigemId,
        produtoId: it.produtoOrigemId,
        tipo: 'ENTRADA_DEVOLUCAO',
        quantidade: q.toFixed(4),
        precoUnitario: c.toFixed(6),
        valorTotal: it.valorTotal,
        dataHora: agora,
        movimentoPaiId: it.movSaidaId,
        observacao: obs,
        criadoPor: userId,
      });
      await aplicarMpmEntrada({ produtoId: it.produtoOrigemId, qtdEntrada: q, custoEntrada: c, exec: tx });
      // sai do destino e tira da média
      await tx.insert(schema.movimentoEstoque).values({
        filialId: t.filialDestinoId,
        produtoId: it.produtoDestinoId,
        tipo: 'SAIDA_DEVOLUCAO',
        quantidade: (-q).toFixed(4),
        precoUnitario: c.toFixed(6),
        valorTotal: it.valorTotal,
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
