// Boletos pagos pela conta do Inter × Contas a pagar: a regra que casa cada
// boleto com UMA conta. Usada pela tela /financeiro/boletos-inter e pela rota
// que lança o "pagamento entre casas" (boleto lançado numa casa e pago pelo
// Inter da outra — entra no encontro de contas, decisão do dono 14/10/2026).

import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { InterPagamento } from '@/lib/inter';

export const soDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
export const centavos = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);

/** Soma dias a um YYYY-MM-DD sem passar por fuso. */
export function somaDias(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** CANCELADO, AGENDADO_CANCELADO etc.: o dinheiro não saiu */
export const pagamentoCancelado = (p: InterPagamento) => (p.statusPagamento ?? '').includes('CANCEL');

/** Agendado e ainda não pago: o dinheiro ainda não saiu */
export const pagamentoAgendado = (p: InterPagamento) =>
  !pagamentoCancelado(p) && (p.statusPagamento ?? '').includes('AGEND');

/** Contas a pagar das casas numa janela larga em volta do período (o boleto
 *  pode ter sido lançado com vencimento bem antes ou depois do dia em que foi
 *  pago). */
export async function contasDaJanela(filialIds: string[], dataIni: string, dataFim: string) {
  if (!filialIds.length) return [];
  return db
    .select({
      id: schema.contaPagar.id,
      filialId: schema.contaPagar.filialId,
      valor: schema.contaPagar.valor,
      dataVencimento: schema.contaPagar.dataVencimento,
      dataPagamento: schema.contaPagar.dataPagamento,
      valorPago: schema.contaPagar.valorPago,
      jurosMulta: schema.contaPagar.jurosMulta,
      origem: schema.contaPagar.origem,
      descricao: schema.contaPagar.descricao,
      fornecedorNome: schema.fornecedor.nome,
      fornecedorCnpj: schema.fornecedor.cnpjOuCpf,
    })
    .from(schema.contaPagar)
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    .where(
      and(
        inArray(schema.contaPagar.filialId, filialIds),
        isNull(schema.contaPagar.dataDelete),
        gte(schema.contaPagar.dataVencimento, somaDias(dataIni, -60)),
        lte(schema.contaPagar.dataVencimento, somaDias(dataFim, 60)),
      ),
    );
}

export type ContaJanela = Awaited<ReturnType<typeof contasDaJanela>>[number];

/** Casa cada boleto com UMA conta: mesmo valor (o do título ou o pago, com
 *  juros) e mesmo CNPJ do fornecedor; sem CNPJ batendo, mesmo valor e mesmo
 *  vencimento. Conta já usada não casa de novo. Procura primeiro na casa dona
 *  da conta do Inter (`filialId`); a conta de OUTRA casa só ganha quando bate
 *  valor + CNPJ + vencimento, ou quando a casa não tem nenhuma candidata.
 *
 *  Duas passadas: primeiro todos os casamentos exatos (valor + CNPJ +
 *  vencimento), depois o resto. Numa passada só, o boleto pago depois roubava
 *  por valor + CNPJ a conta que era exatamente de outro boleto (Prime Food Hub
 *  pago 2x pelo Inter da Mar, 05 e 13/10/2026, com uma conta só).
 *
 *  Devolve a conta de cada boleto na mesma ordem de `pagamentos`. */
export function casarBoletos(
  pagamentos: InterPagamento[],
  contas: ContaJanela[],
  filialId: string | null | undefined,
): Array<ContaJanela | null> {
  const usadas = new Set<string>();
  const res: Array<ContaJanela | null> = pagamentos.map(() => null);
  const regras = pagamentos.map((p) => {
    const valores = new Set([centavos(p.valorNominal), centavos(p.valorPago)]);
    const cnpj = soDigitos(p.cpfCnpjBeneficiario);
    return {
      livres: () => contas.filter((c) => !usadas.has(c.id) && valores.has(centavos(c.valor))),
      mesmoCnpj: (c: ContaJanela) => !!cnpj && soDigitos(c.fornecedorCnpj) === cnpj,
      mesmoVenc: (c: ContaJanela) =>
        c.dataVencimento === p.dataVencimentoTitulo || c.dataVencimento === p.dataVencimentoDigitada,
    };
  });
  const usar = (i: number, c: ContaJanela | null | undefined) => {
    if (!c) return;
    res[i] = c;
    usadas.add(c.id);
  };

  // 1ª passada: valor + CNPJ + vencimento (da casa, depois de fora)
  regras.forEach((r, i) => {
    const cand = r.livres();
    const exato = (c: ContaJanela) => r.mesmoCnpj(c) && r.mesmoVenc(c);
    usar(
      i,
      cand.find((c) => c.filialId === filialId && exato(c)) ??
        cand.find((c) => c.filialId !== filialId && exato(c)),
    );
  });
  // 2ª passada: o que sobrou, só por CNPJ ou só por vencimento
  regras.forEach((r, i) => {
    if (res[i]) return;
    const cand = r.livres();
    const daCasa = cand.filter((c) => c.filialId === filialId);
    const deFora = cand.filter((c) => c.filialId !== filialId);
    usar(
      i,
      daCasa.find(r.mesmoCnpj) ??
        daCasa.find(r.mesmoVenc) ??
        deFora.find(r.mesmoCnpj) ??
        deFora.find(r.mesmoVenc),
    );
  });
  return res;
}
