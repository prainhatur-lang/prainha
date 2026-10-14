// Pagamento entre casas: boleto lançado numa casa e pago pela conta do Inter
// da OUTRA (o Inter do Bar pagou a tinta da Mar). Decisão do dono (14/10/2026):
// a conta fica na casa dela, baixada normalmente, e a casa da conta fica
// devendo pra casa que pagou — entra no encontro de contas do mês do pagamento,
// junto com as transferências (ver previaEncontro em lib/transferencia.ts).

import { db, schema } from '@concilia/db';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { buscarPagamentosInter, resolverCredenciaisInterPagamentos } from '@/lib/inter';
import { centavos, pagamentoAgendado, pagamentoCancelado } from '@/lib/boletos-inter';
import { RecusaTransf } from '@/lib/transferencia';

const dataBr = (ymd: string) => ymd.split('-').reverse().join('/');

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
