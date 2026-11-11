// Baixa automática dos boletos pagos pelo Inter (cron /api/cron/baixa-boletos-inter).
// Faz sozinho o que o botão "Baixar todas" de /financeiro/boletos-inter faz:
// mesmas contas, mesmo casamento (casarBoletos), mesma baixa (saldo na data em
// que o banco pagou, o que passou do saldo vai como juros, observação
// "Boleto pago no Inter (<codigo>)"). Fica de fora o mesmo que fica fora do
// lote da tela — conta de outra casa (encontro/bloqueio), "conferir" (casou só
// por valor + CNPJ ou valor diferente), conta do PDV com Consumer ativo — e
// também boleto só agendado ou com data futura (o dinheiro ainda não saiu).
// A tela e o botão continuam iguais. Pedido do dono 11/11/2026 (Tabuará).

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { buscarPagamentosInter, resolverCredenciaisInterPagamentos, type InterPagamento } from '@/lib/inter';
import {
  casarBoletos,
  centavos,
  contasBaixadasPorBoleto,
  contasDaJanela,
  pagamentoAgendado,
  pagamentoCancelado,
  soDigitos,
  type ContaJanela,
} from '@/lib/boletos-inter';
import { casasComConsumerParado } from '@/lib/consumer-contas';
import { recalcularAgregado } from '@/lib/conta-pagar-baixa';

export interface BaixaAuto {
  contaId: string;
  data: string;
  valor: number;
  juros: number;
  observacao: string;
  rotulo: string;
}

/** O que o "Baixar todas" da tela baixaria pra esta casa (mesma regra do lote). */
export function loteDeBaixa(
  pagamentos: InterPagamento[],
  casadas: (ContaJanela | null | undefined)[],
  filialId: string,
  consumerParado: Set<string>,
  hoje: string,
): BaixaAuto[] {
  const lote: BaixaAuto[] = [];
  pagamentos.forEach((p, i) => {
    const conta = casadas[i];
    if (!conta || conta.filialId !== filialId || conta.dataPagamento) return;
    if (conta.origem === 'CONSUMER' && !consumerParado.has(conta.filialId)) return;
    if (!p.dataPagamento || pagamentoAgendado(p) || p.dataPagamento.slice(0, 10) > hoje) return;
    const saldo =
      (centavos(conta.valor) - (centavos(conta.valorPago) - centavos(conta.jurosMulta))) / 100;
    if (saldo <= 0) return;
    const pagoBanco = Number(p.valorPago ?? p.valorNominal ?? 0);
    // vencimento diferente do boleto: pode ser outra conta do mesmo fornecedor
    let conferir =
      conta.dataVencimento !== p.dataVencimentoTitulo &&
      conta.dataVencimento !== p.dataVencimentoDigitada;
    const valorDiferente =
      centavos(conta.valor) !== centavos(p.valorNominal) &&
      centavos(conta.valor) !== centavos(p.valorPago);
    const cnpjBoleto = soDigitos(p.cpfCnpjBeneficiario);
    const cnpjConta = soDigitos(conta.fornecedorCnpj);
    const difPequena =
      valorDiferente &&
      !!cnpjBoleto &&
      (cnpjConta === cnpjBoleto ||
        (cnpjBoleto.length === 14 && cnpjConta.slice(0, 8) === cnpjBoleto.slice(0, 8))) &&
      (conta.dataVencimento === p.dataVencimentoTitulo ||
        conta.dataVencimento === p.dataVencimentoDigitada) &&
      Math.abs(centavos(conta.valor) - centavos(p.valorNominal)) <=
        Math.round(centavos(p.valorNominal) * 0.01);
    if (valorDiferente && !difPequena) conferir = true;
    if (conferir) return;
    lote.push({
      contaId: conta.id,
      data: p.dataPagamento.slice(0, 10),
      valor: saldo,
      juros: Math.max(0, Math.round((pagoBanco - saldo) * 100) / 100),
      observacao: `Boleto pago no Inter (${p.codigoTransacao})`,
      rotulo: `${p.nomeBeneficiario ?? conta.fornecedorNome ?? 'boleto'} venc. ${conta.dataVencimento.split('-').reverse().join('/')}`,
    });
  });
  return lote;
}

/** Grava uma baixa (igual à rota POST /api/financeiro/contas/[id]/baixas),
 *  conferindo o saldo de novo na hora — clique na tela ao mesmo tempo não dobra. */
async function gravarBaixa(b: BaixaAuto): Promise<'ok' | string> {
  const [conta] = await db
    .select({
      filialId: schema.contaPagar.filialId,
      valor: schema.contaPagar.valor,
      dataPagamento: schema.contaPagar.dataPagamento,
      dataDelete: schema.contaPagar.dataDelete,
    })
    .from(schema.contaPagar)
    .where(eq(schema.contaPagar.id, b.contaId))
    .limit(1);
  if (!conta || conta.dataDelete) return 'conta não encontrada';
  if (conta.dataPagamento) return 'já paga';
  const baixas = await db
    .select({ valor: schema.contaPagarBaixa.valor, observacao: schema.contaPagarBaixa.observacao })
    .from(schema.contaPagarBaixa)
    .where(eq(schema.contaPagarBaixa.contaPagarId, b.contaId));
  if (baixas.some((x) => x.observacao === b.observacao)) return 'boleto já baixado';
  const saldo = Number(conta.valor) - baixas.reduce((s, x) => s + Number(x.valor), 0);
  if (b.valor > saldo + 0.005) return `saldo mudou (R$ ${saldo.toFixed(2)})`;
  await db.insert(schema.contaPagarBaixa).values({
    filialId: conta.filialId,
    contaPagarId: b.contaId,
    data: b.data,
    valor: b.valor.toFixed(2),
    juros: b.juros > 0 ? b.juros.toFixed(2) : null,
    observacao: b.observacao,
    criadoPor: null,
  });
  await recalcularAgregado(b.contaId, Number(conta.valor));
  return 'ok';
}

/** Casas com a integração de pagamentos do Inter configurada. */
export async function casasComBoletoInter(): Promise<{ id: string; nome: string; organizacaoId: string }[]> {
  const filiais = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome, organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial);
  return filiais.filter((f) => resolverCredenciaisInterPagamentos(f.id));
}

export async function baixarBoletosInterAuto(opts: {
  filialId: string;
  dias?: number;
  /** true = só calcula, não grava */
  simular?: boolean;
}) {
  const cred = resolverCredenciaisInterPagamentos(opts.filialId);
  if (!cred) return { filialId: opts.filialId, erro: 'sem integração de pagamentos do Inter' };
  const hoje = hojeBr();
  const ini = diasAtrasBr(opts.dias ?? 15);
  const pagamentos = (await buscarPagamentosInter(cred, ini, hoje)).filter((p) => !pagamentoCancelado(p));
  if (pagamentos.length === 0) return { filialId: opts.filialId, boletos: 0, baixadas: [], falhas: [] };

  // contas de todas as casas da organização: o boleto de outra casa casa com a
  // conta dela e fica fora (encontro de contas, igual à tela)
  const [pagadora] = await db
    .select({ organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, opts.filialId))
    .limit(1);
  const casas = pagadora
    ? (
        await db
          .select({ id: schema.filial.id })
          .from(schema.filial)
          .where(eq(schema.filial.organizacaoId, pagadora.organizacaoId))
      ).map((f) => f.id)
    : [opts.filialId];
  const contas = await contasDaJanela(casas, ini, hoje);
  const baixadasAntes = await contasBaixadasPorBoleto(casas, pagamentos, ini, hoje);
  const casadas = casarBoletos(pagamentos, contas, opts.filialId, baixadasAntes);
  const parado = await casasComConsumerParado(
    casadas.filter((c) => c?.origem === 'CONSUMER').map((c) => c!.filialId),
  );
  const lote = loteDeBaixa(pagamentos, casadas, opts.filialId, parado, hoje);

  const baixadas: BaixaAuto[] = [];
  const falhas: { rotulo: string; motivo: string }[] = [];
  const vistas = new Set<string>();
  for (const b of lote) {
    if (vistas.has(b.contaId)) {
      falhas.push({ rotulo: b.rotulo, motivo: 'dois boletos na mesma conta' });
      continue;
    }
    vistas.add(b.contaId);
    if (opts.simular) {
      baixadas.push(b);
      continue;
    }
    try {
      const r = await gravarBaixa(b);
      if (r === 'ok') baixadas.push(b);
      else falhas.push({ rotulo: b.rotulo, motivo: r });
    } catch (e) {
      falhas.push({ rotulo: b.rotulo, motivo: (e as Error).message });
    }
  }
  return { filialId: opts.filialId, boletos: pagamentos.length, baixadas, falhas };
}
