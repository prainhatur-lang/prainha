// Boletos pagos pela conta do Inter × Contas a pagar: a regra que casa cada
// boleto com UMA conta. Usada pela tela /financeiro/boletos-inter e pela rota
// que lança o "pagamento entre casas" (boleto lançado numa casa e pago pelo
// Inter da outra — entra no encontro de contas, decisão do dono 14/10/2026).

import { db, schema } from '@concilia/db';
import { and, eq, gte, ilike, inArray, isNull, lte } from 'drizzle-orm';
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

/** O texto da baixa cita este boleto? Formato da tela ("Boleto pago no Inter
 *  (<codigo>)") e o antigo, com só os 8 primeiros ("(transação e073a7bd)"). */
export function baixaCitaBoleto(observacao: string | null | undefined, codigo: string): boolean {
  const t = observacao ?? '';
  if (!codigo || !t) return false;
  if (t.includes(`(${codigo})`)) return true;
  return codigo.length >= 8 && t.includes(`transação ${codigo.slice(0, 8)}`);
}

/** Contas que JÁ foram baixadas por cada boleto (o texto da baixa cita o
 *  código do Inter). Esse é o casamento que vale: o boleto já quitou aquela
 *  conta, então não pode casar com outra — nem ir pro encontro como conta da
 *  outra casa. Caso Laticínios (14/10/2026): o boleto do Inter do Bar foi pro
 *  encontro como conta da Mar e, depois, a conta do Bar foi lançada e baixada
 *  pelo mesmo boleto — a Mar ficou devendo uma conta que o Bar pagou pra ele
 *  mesmo. Chave = codigoTransacao do boleto. */
export async function contasBaixadasPorBoleto(
  filialIds: string[],
  pagamentos: InterPagamento[],
  dataIni: string,
  dataFim: string,
): Promise<Map<string, ContaJanela[]>> {
  const res = new Map<string, ContaJanela[]>();
  if (!filialIds.length || !pagamentos.length) return res;
  const baixas = await db
    .select({
      observacao: schema.contaPagarBaixa.observacao,
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
    .from(schema.contaPagarBaixa)
    .innerJoin(schema.contaPagar, eq(schema.contaPagar.id, schema.contaPagarBaixa.contaPagarId))
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    .where(
      and(
        inArray(schema.contaPagarBaixa.filialId, filialIds),
        isNull(schema.contaPagar.dataDelete),
        ilike(schema.contaPagarBaixa.observacao, '%Inter%'),
        gte(schema.contaPagarBaixa.data, somaDias(dataIni, -30)),
        lte(schema.contaPagarBaixa.data, somaDias(dataFim, 30)),
      ),
    );
  for (const p of pagamentos) {
    const vistas = new Set<string>();
    const cs: ContaJanela[] = [];
    for (const b of baixas) {
      if (vistas.has(b.id) || !baixaCitaBoleto(b.observacao, p.codigoTransacao)) continue;
      vistas.add(b.id);
      const { observacao: _obs, ...conta } = b;
      cs.push(conta);
    }
    if (cs.length) res.set(p.codigoTransacao, cs);
  }
  return res;
}

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
  /** contasBaixadasPorBoleto: a conta que o boleto já baixou ganha de tudo */
  baixadas?: Map<string, ContaJanela[]>,
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

  // passada 0: a conta que este boleto já baixou (da casa primeiro). Sem
  // isso, a conta de outra casa com o mesmo valor ganhava a da própria casa e
  // o boleto ia pro encontro "ao contrário" (Prime Food, Mar × Bar, 10/2026).
  if (baixadas) {
    pagamentos.forEach((p, i) => {
      const cs = (baixadas.get(p.codigoTransacao) ?? []).filter((c) => !usadas.has(c.id));
      usar(i, cs.find((c) => c.filialId === filialId) ?? cs[0]);
    });
  }
  // 1ª passada: valor + CNPJ + vencimento (da casa, depois de fora)
  regras.forEach((r, i) => {
    if (res[i]) return;
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
