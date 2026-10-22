// Pagamento entre casas: boleto lançado numa casa e pago pela conta do Inter
// da OUTRA (o Inter do Bar pagou a tinta da Mar). Decisão do dono (14/10/2026):
// a conta fica na casa dela, baixada normalmente, e a casa da conta fica
// devendo pra casa que pagou — entra no encontro de contas do mês do pagamento,
// junto com as transferências (ver previaEncontro em lib/transferencia.ts).

import { db, schema } from '@concilia/db';
import { and, eq, gte, ilike, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { buscarPagamentosInter, resolverCredenciaisInterPagamentos } from '@/lib/inter';
import {
  baixaCitaBoleto,
  centavos,
  pagamentoAgendado,
  pagamentoCancelado,
  somaDias,
} from '@/lib/boletos-inter';
import { RecusaTransf } from '@/lib/transferencia';
import { consumerParado } from '@/lib/consumer-contas';
import { recalcularAgregado } from '@/lib/conta-pagar-baixa';
import { ehAdmin } from '@/lib/usuario-admin';

const dataBr = (ymd: string) => ymd.split('-').reverse().join('/');

// Regra do dono (22/10/2026): daqui pra frente uma casa NÃO paga conta de
// outra. A casa que está na nota paga o fornecedor; mercadoria que vai pra
// outra casa sai por transferência (que gera o crédito) e as casas se acertam
// no encontro de contas. Pagamento feito antes da data segue lançando como
// sempre; do dia em diante só o Admin lança (o banco já pagou pela casa
// errada e o dinheiro precisa ser acertado de algum jeito).
export const BLOQUEIO_ENTRE_CASAS_DESDE = '2026-10-22';
export const MSG_BLOQUEIO_ENTRE_CASAS =
  'Desde 22/10/2026 uma casa não paga conta de outra (regra do dono). A casa que está na nota paga o fornecedor; mercadoria pra outra casa vai por transferência, que gera o crédito, e as casas se acertam no encontro. Pagamento que já saiu pela casa errada: só o Admin lança.';

/** Pagamento de conta de OUTRA casa feito nessa data fica travado pra quem
 *  não é Admin. Sem data (ainda agendado) conta como daqui pra frente. */
export function entreCasasBloqueado(data: string | null | undefined, admin: boolean) {
  if (admin) return false;
  return !data || data.slice(0, 10) >= BLOQUEIO_ENTRE_CASAS_DESDE;
}

/** Lança no encontro de contas os boletos que o Inter da `filialPagadoraId`
 *  pagou pra contas de outra casa. Confere tudo de novo no servidor: o
 *  pagamento tem que estar no Inter (período da tela), pago de verdade, e a
 *  conta tem que ser de outra casa que o usuário acessa, com o mesmo valor.
 *  O mesmo pagamento não entra duas vezes; um desfeito volta a valer. */
export async function lancarPagamentosEntreCasas(opts: {
  userId: string;
  filialPagadoraId: string;
  dataIni: string;
  dataFim: string;
  itens: Array<{ codigo: string; contaId: string }>;
}) {
  const { userId, filialPagadoraId } = opts;
  const filiais = await filiaisDoUsuario(userId);
  const nome = new Map(filiais.map((f) => [f.id, f.nome]));
  if (!nome.has(filialPagadoraId)) throw new RecusaTransf('sem acesso a essa casa');
  const cred = resolverCredenciaisInterPagamentos(filialPagadoraId);
  if (!cred) throw new RecusaTransf('a conta do Inter dessa casa não tem a consulta de pagamentos ligada');

  const pagamentos = new Map(
    (await buscarPagamentosInter(cred, opts.dataIni, opts.dataFim)).map((p) => [p.codigoTransacao, p]),
  );
  const contaIds = [...new Set(opts.itens.map((i) => i.contaId))];
  const contas = new Map(
    (
      await db
        .select({
          id: schema.contaPagar.id,
          filialId: schema.contaPagar.filialId,
          valor: schema.contaPagar.valor,
          dataVencimento: schema.contaPagar.dataVencimento,
          dataDelete: schema.contaPagar.dataDelete,
          fornecedorNome: schema.fornecedor.nome,
        })
        .from(schema.contaPagar)
        .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
        .where(inArray(schema.contaPagar.id, contaIds))
    ).map((c) => [c.id, c]),
  );
  // conta que já está em outro pagamento entre casas (outro código) não entra de novo
  const jaUsadas = new Map(
    (
      await db
        .select({
          contaPagarId: schema.pagamentoEntreCasas.contaPagarId,
          codigo: schema.pagamentoEntreCasas.codigoExterno,
        })
        .from(schema.pagamentoEntreCasas)
        .where(
          and(
            inArray(schema.pagamentoEntreCasas.contaPagarId, contaIds),
            ne(schema.pagamentoEntreCasas.status, 'CANCELADO'),
          ),
        )
    ).map((r) => [r.contaPagarId, r.codigo]),
  );

  // Boleto que já baixou uma conta da PRÓPRIA casa que pagou: a conta é dela,
  // não entra no encontro (senão a outra casa fica devendo o que a pagadora
  // pagou pra ela mesma — Laticínios, Bar × Mar, 14/10/2026).
  const baixasDaPagadora = await db
    .select({
      observacao: schema.contaPagarBaixa.observacao,
      fornecedorNome: schema.fornecedor.nome,
      descricao: schema.contaPagar.descricao,
    })
    .from(schema.contaPagarBaixa)
    .innerJoin(schema.contaPagar, eq(schema.contaPagar.id, schema.contaPagarBaixa.contaPagarId))
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    .where(
      and(
        eq(schema.contaPagarBaixa.filialId, filialPagadoraId),
        isNull(schema.contaPagar.dataDelete),
        ilike(schema.contaPagarBaixa.observacao, '%Inter%'),
        gte(schema.contaPagarBaixa.data, somaDias(opts.dataIni, -30)),
        lte(schema.contaPagarBaixa.data, somaDias(opts.dataFim, 30)),
      ),
    );

  const admin = await ehAdmin(userId);
  const lancados: string[] = [];
  const recusados: Array<{ codigo: string; motivo: string }> = [];
  for (const it of opts.itens) {
    const p = pagamentos.get(it.codigo);
    const c = contas.get(it.contaId);
    const recusa = (motivo: string) => recusados.push({ codigo: it.codigo, motivo });
    if (!p) { recusa('pagamento não encontrado no Inter nesse período'); continue; }
    if (pagamentoCancelado(p)) { recusa('pagamento cancelado no banco'); continue; }
    if (pagamentoAgendado(p) || !p.dataPagamento) { recusa('pagamento ainda agendado'); continue; }
    if (!c || c.dataDelete) { recusa('conta não encontrada'); continue; }
    if (c.filialId === filialPagadoraId) { recusa('a conta é da mesma casa que pagou'); continue; }
    if (!nome.has(c.filialId)) { recusa('sem acesso à casa da conta'); continue; }
    if (![centavos(p.valorNominal), centavos(p.valorPago)].includes(centavos(c.valor))) {
      recusa('valor da conta não bate com o boleto');
      continue;
    }
    const outro = jaUsadas.get(c.id);
    if (outro && outro !== p.codigoTransacao) { recusa('essa conta já está em outro pagamento entre casas'); continue; }
    const daPropria = baixasDaPagadora.find((b) => baixaCitaBoleto(b.observacao, p.codigoTransacao));
    if (daPropria) {
      recusa(
        `esse boleto já baixou a conta ${daPropria.fornecedorNome ?? daPropria.descricao ?? ''} da ${nome.get(filialPagadoraId)} — a conta é dela, não entra no encontro`,
      );
      continue;
    }
    if (entreCasasBloqueado(p.dataPagamento, admin)) {
      recusa(`pago em ${dataBr(p.dataPagamento.slice(0, 10))} pela casa errada. ${MSG_BLOQUEIO_ENTRE_CASAS}`);
      continue;
    }

    const data = p.dataPagamento.slice(0, 10);
    const valor = Number(p.valorPago ?? p.valorNominal ?? 0).toFixed(2);
    const descricao = `${p.nomeBeneficiario ?? c.fornecedorNome ?? 'Boleto'} — venc. ${dataBr(c.dataVencimento)}, pago pelo Inter da ${nome.get(filialPagadoraId)}`;
    const valores = {
      filialPagadoraId,
      filialDevedoraId: c.filialId,
      contaPagarId: c.id,
      origem: 'INTER_BOLETO',
      codigoExterno: p.codigoTransacao,
      data,
      competencia: data.slice(0, 7),
      valor,
      descricao,
      status: 'ABERTO',
      criadoPor: userId,
    };
    // novo, ou um desfeito (CANCELADO) que volta; ABERTO/COMPENSADO fica como está
    await db
      .insert(schema.pagamentoEntreCasas)
      .values(valores)
      .onConflictDoUpdate({
        target: [schema.pagamentoEntreCasas.filialPagadoraId, schema.pagamentoEntreCasas.codigoExterno],
        set: { ...valores, criadoEm: new Date(), canceladoPor: null, canceladoEm: null, encontroId: null },
        setWhere: sql`${schema.pagamentoEntreCasas.status} = 'CANCELADO'`,
      });
    lancados.push(it.codigo);
  }
  return { lancados, recusados };
}

/** Desfaz um lançamento que ainda não entrou num encontro fechado. */
export async function desfazerPagamentoEntreCasas(userId: string, id: string) {
  const [r] = await db
    .select()
    .from(schema.pagamentoEntreCasas)
    .where(eq(schema.pagamentoEntreCasas.id, id));
  if (!r) throw new RecusaTransf('lançamento não encontrado');
  const filiais = new Set((await filiaisDoUsuario(userId)).map((f) => f.id));
  if (!filiais.has(r.filialPagadoraId) || !filiais.has(r.filialDevedoraId)) {
    throw new RecusaTransf('sem acesso às duas casas');
  }
  if (r.status !== 'ABERTO') {
    throw new RecusaTransf(
      r.status === 'COMPENSADO' ? 'já entrou num encontro de contas fechado' : 'já foi desfeito',
    );
  }
  await db
    .update(schema.pagamentoEntreCasas)
    .set({ status: 'CANCELADO', canceladoPor: userId, canceladoEm: new Date() })
    .where(and(eq(schema.pagamentoEntreCasas.id, id), eq(schema.pagamentoEntreCasas.status, 'ABERTO')));
  return { id };
}

/** Formas de pagamento do lançamento à mão (botão "Paga por outra casa"). */
export const FORMAS_PAGAMENTO_CASA = ['Pix', 'Boleto', 'Transferência', 'Cartão', 'Dinheiro', 'Outro'] as const;

/** Conta de uma casa paga por OUTRA casa fora do Inter (Pix de outro banco,
 *  cartão, dinheiro...) — pedido do dono 20/10/2026. Lança à mão no encontro
 *  de contas do mês do pagamento (origem MANUAL) e, se pedido, dá a baixa na
 *  conta pelas mesmas regras da tela de baixas. Uma conta só tem um
 *  pagamento entre casas valendo; um desfeito libera lançar de novo. */
export async function lancarPagamentoManualEntreCasas(opts: {
  userId: string;
  contaId: string;
  filialPagadoraId: string;
  data: string;
  valor: number;
  forma: string;
  observacao?: string | null;
  darBaixa: boolean;
}) {
  const { userId, contaId, filialPagadoraId } = opts;
  const filiais = await filiaisDoUsuario(userId);
  const nome = new Map(filiais.map((f) => [f.id, f.nome]));
  if (!nome.has(filialPagadoraId)) throw new RecusaTransf('sem acesso à casa que pagou');

  const [c] = await db
    .select({
      id: schema.contaPagar.id,
      filialId: schema.contaPagar.filialId,
      valor: schema.contaPagar.valor,
      origem: schema.contaPagar.origem,
      dataVencimento: schema.contaPagar.dataVencimento,
      dataPagamento: schema.contaPagar.dataPagamento,
      dataDelete: schema.contaPagar.dataDelete,
      descricao: schema.contaPagar.descricao,
      fornecedorNome: schema.fornecedor.nome,
    })
    .from(schema.contaPagar)
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    .where(eq(schema.contaPagar.id, contaId))
    .limit(1);
  if (!c || c.dataDelete) throw new RecusaTransf('conta não encontrada');
  if (!nome.has(c.filialId)) throw new RecusaTransf('sem acesso à casa da conta');
  if (c.filialId === filialPagadoraId) throw new RecusaTransf('a casa que pagou é a mesma da conta — use "Registrar pagamento"');
  // regra do dono 22/10/2026: lançamento à mão de uma casa pagando outra só
  // pelo Admin, qualquer data (não tem banco pra provar quando saiu)
  if (!(await ehAdmin(userId))) throw new RecusaTransf(MSG_BLOQUEIO_ENTRE_CASAS);

  const [ativo] = await db
    .select({ id: schema.pagamentoEntreCasas.id })
    .from(schema.pagamentoEntreCasas)
    .where(
      and(
        eq(schema.pagamentoEntreCasas.contaPagarId, contaId),
        ne(schema.pagamentoEntreCasas.status, 'CANCELADO'),
      ),
    )
    .limit(1);
  if (ativo) throw new RecusaTransf('essa conta já está no encontro de contas — desfaça o lançamento antes');

  const valorConta = Number(c.valor);
  const baixasDaqui = await db
    .select({ valor: schema.contaPagarBaixa.valor })
    .from(schema.contaPagarBaixa)
    .where(eq(schema.contaPagarBaixa.contaPagarId, contaId));
  const saldo = valorConta - baixasDaqui.reduce((s, x) => s + Number(x.valor), 0);
  let baixar = opts.darBaixa && saldo > 0.005;
  if (baixar && c.origem === 'CONSUMER') {
    if (!(await consumerParado(c.filialId))) {
      throw new RecusaTransf('conta do Consumer: a baixa é feita no PDV — desmarque "dar baixa" pra só lançar no encontro');
    }
    if (c.dataPagamento && baixasDaqui.length === 0) baixar = false; // o Consumer já pagou
  }

  const casa = nome.get(filialPagadoraId);
  const forma = opts.forma.trim();
  const obs = opts.observacao?.trim();
  const descricao =
    `${c.fornecedorNome ?? c.descricao ?? 'Conta'} — venc. ${dataBr(c.dataVencimento)}, pago pela ${casa} (${forma})` +
    (obs ? ` · ${obs}` : '');
  const valor = opts.valor.toFixed(2);

  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(schema.pagamentoEntreCasas)
      .values({
        filialPagadoraId,
        filialDevedoraId: c.filialId,
        contaPagarId: contaId,
        origem: 'MANUAL',
        codigoExterno: null,
        data: opts.data,
        competencia: opts.data.slice(0, 7),
        valor,
        descricao,
        status: 'ABERTO',
        criadoPor: userId,
      })
      .returning({ id: schema.pagamentoEntreCasas.id });
    let baixou = false;
    if (baixar) {
      // principal abate o saldo; o que passar dele vai como juros (igual à baixa)
      const principal = Math.min(opts.valor, saldo);
      const juros = opts.valor - principal;
      await tx.insert(schema.contaPagarBaixa).values({
        filialId: c.filialId,
        contaPagarId: contaId,
        data: opts.data,
        valor: principal.toFixed(2),
        juros: juros > 0.005 ? juros.toFixed(2) : null,
        observacao: `pago pela ${casa} (${forma}) — encontro de contas${obs ? ` · ${obs}` : ''}`,
        criadoPor: userId,
      });
      await recalcularAgregado(contaId, valorConta, tx);
      baixou = true;
    }
    return { id: p!.id, competencia: opts.data.slice(0, 7), baixou };
  });
}
