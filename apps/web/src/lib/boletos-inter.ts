// Boletos pagos pela conta do Inter × Contas a pagar: a regra que casa cada
// boleto com UMA conta. Usada pela tela /financeiro/boletos-inter e pela rota
// que lança o "pagamento entre casas" (boleto lançado numa casa e pago pelo
// Inter da outra — entra no encontro de contas, decisão do dono 14/10/2026).

import { db, schema } from '@concilia/db';
import { and, eq, gte, ilike, inArray, isNull, lte, sql } from 'drizzle-orm';
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
      // mesma empresa, outro estabelecimento: o boleto sai pela matriz e a
      // nota pela filial (Megga 0001-88 × 0009-35, Mar, 16/10/2026)
      mesmaRaiz: (c: ContaJanela) =>
        cnpj.length === 14 && soDigitos(c.fornecedorCnpj).slice(0, 8) === cnpj.slice(0, 8),
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
        deFora.find(r.mesmoVenc) ??
        daCasa.find(r.mesmaRaiz) ??
        deFora.find(r.mesmaRaiz),
    );
  });
  // 3ª passada: mesmo CNPJ + mesmo vencimento e valor até 5% diferente — a
  // conta lançada pelo pedido/nota com centavos a menos que o boleto (CRBS
  // 4.302,64 × boleto 4.304,19, Bar, 26/10/2026; a CRBS às vezes põe o
  // financeiro ou juros no boleto). Só com UMA candidata; a
  // tela marca "valor diferente, confira" e deixa fora do lote.
  pagamentos.forEach((p, i) => {
    if (res[i]) return;
    const r = regras[i]!;
    const alvo = centavos(p.valorNominal) || centavos(p.valorPago);
    if (!alvo) return;
    const perto = contas.filter(
      (c) =>
        !usadas.has(c.id) &&
        (r.mesmoCnpj(c) || r.mesmaRaiz(c)) &&
        r.mesmoVenc(c) &&
        Math.abs(centavos(c.valor) - alvo) <= Math.round(alvo * 0.05),
    );
    const daCasa = perto.filter((c) => c.filialId === filialId);
    const lista = daCasa.length ? daCasa : perto;
    if (lista.length === 1) usar(i, lista[0]);
  });
  // 4ª passada: mesmo CNPJ (ou raiz), valor até R$ 10 diferente e vencimento
  // até 10 dias de distância. A CRBS (Ambev) cobra R$ 1,55 de tarifa no boleto
  // (nota 3.308,88 × boleto 3.310,43) e o vencimento do boleto nem sempre é o
  // da duplicata — por isso nunca conciliava (dono, 30/10/2026). Só com UMA
  // candidata (a mais perto em valor se houver empate de casa); a tela marca
  // "valor diferente, confira".
  pagamentos.forEach((p, i) => {
    if (res[i]) return;
    const r = regras[i]!;
    const alvo = centavos(p.valorNominal) || centavos(p.valorPago);
    if (!alvo) return;
    const venc = p.dataVencimentoTitulo || p.dataVencimentoDigitada;
    const perto = contas.filter(
      (c) =>
        !usadas.has(c.id) &&
        (r.mesmoCnpj(c) || r.mesmaRaiz(c)) &&
        Math.abs(centavos(c.valor) - alvo) <= 1000 &&
        (!venc || !c.dataVencimento || Math.abs(diasEntre(c.dataVencimento, venc)) <= 10),
    );
    const daCasa = perto.filter((c) => c.filialId === filialId);
    const lista = daCasa.length ? daCasa : perto;
    if (lista.length === 1) usar(i, lista[0]);
  });
  return res;
}

function diasEntre(a: string, b: string): number {
  const ta = Date.parse(`${String(a).slice(0, 10)}T12:00:00Z`);
  const tb = Date.parse(`${String(b).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((ta - tb) / 86400000);
}

/** Boleto sem conta: a nota de compra do mesmo fornecedor (raiz do CNPJ) e
 *  mesmo valor que chegou da SEFAZ mas nunca virou conta a pagar (Megga
 *  628617 e Maxx 35110, Mar, pagas 15/10/2026). Só aponta; quem lança é a
 *  tela da nota. Uma nota por boleto. */
export async function notasSemContaDosBoletos(
  filialIds: string[],
  pagamentos: InterPagamento[],
  filialId: string | null | undefined,
): Promise<Map<string, { id: string; filialId: string; numero: number | null; valorTotal: string | null; dataEmissao: Date | null }>> {
  const res = new Map<string, { id: string; filialId: string; numero: number | null; valorTotal: string | null; dataEmissao: Date | null }>();
  const raizes = [...new Set(pagamentos.map((p) => soDigitos(p.cpfCnpjBeneficiario)).filter((c) => c.length === 14).map((c) => c.slice(0, 8)))];
  if (!filialIds.length || !raizes.length) return res;
  const notas = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      numero: schema.notaCompra.numero,
      valorTotal: schema.notaCompra.valorTotal,
      dataEmissao: schema.notaCompra.dataEmissao,
      emitCnpj: schema.notaCompra.emitCnpj,
    })
    .from(schema.notaCompra)
    .where(
      and(
        inArray(schema.notaCompra.filialId, filialIds),
        inArray(sql`left(${schema.notaCompra.emitCnpj}, 8)`, raizes),
        gte(schema.notaCompra.dataEmissao, new Date(Date.now() - 180 * 86400000)),
        sql`not exists (select 1 from conta_pagar cp where cp.nota_compra_id = ${schema.notaCompra.id} and cp.data_delete is null)`,
      ),
    );
  const usadas = new Set<string>();
  for (const p of pagamentos) {
    const raiz = soDigitos(p.cpfCnpjBeneficiario).slice(0, 8);
    const valor = centavos(p.valorNominal);
    if (raiz.length !== 8 || !valor) continue;
    const cand = notas.filter(
      (n) => !usadas.has(n.id) && soDigitos(n.emitCnpj).slice(0, 8) === raiz && centavos(n.valorTotal) === valor,
    );
    let n = cand.find((x) => x.filialId === filialId) ?? cand[0];
    if (!n) {
      // valor perto (até R$ 10): a CRBS põe R$ 1,55 de tarifa no boleto —
      // a nota 475005 (Tabuará, 1.251,86) foi paga como 1.253,41 e ninguém via.
      // Só com uma candidata (da casa primeiro).
      const perto = notas.filter(
        (x) => !usadas.has(x.id) && soDigitos(x.emitCnpj).slice(0, 8) === raiz && Math.abs(centavos(x.valorTotal) - valor) <= 1000,
      );
      const daCasa = perto.filter((x) => x.filialId === filialId);
      const lista = daCasa.length ? daCasa : perto;
      if (lista.length === 1) n = lista[0];
    }
    if (!n) continue;
    usadas.add(n.id);
    res.set(p.codigoTransacao, n);
  }
  return res;
}

/** Boleto sem conta casada, mas a nota do mesmo fornecedor (raiz do CNPJ) e
 *  mesmo valor (ou até R$ 10 de diferença, só uma candidata) JÁ VIROU conta a
 *  pagar. Aí o "Lançar conta e baixar" não pode aparecer — lançaria a mesma
 *  nota duas vezes (regra do dono, 31/10/2026). A tela mostra o link da conta.
 *  Ignora as contas que já casaram com outro boleto da tela. */
export async function notasLancadasDosBoletos(
  filialIds: string[],
  pagamentos: InterPagamento[],
  filialId: string | null | undefined,
  contasJaCasadas: Set<string>,
): Promise<Map<string, { notaId: string; filialId: string; numero: number | null; contaId: string; paga: boolean }>> {
  const res = new Map<string, { notaId: string; filialId: string; numero: number | null; contaId: string; paga: boolean }>();
  const raizes = [...new Set(pagamentos.map((p) => soDigitos(p.cpfCnpjBeneficiario)).filter((c) => c.length === 14).map((c) => c.slice(0, 8)))];
  if (!filialIds.length || !raizes.length) return res;
  const linhas = await db
    .select({
      notaId: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      numero: schema.notaCompra.numero,
      valorTotal: schema.notaCompra.valorTotal,
      emissao: sql<string>`(${schema.notaCompra.dataEmissao} at time zone 'America/Sao_Paulo')::date::text`,
      emitCnpj: schema.notaCompra.emitCnpj,
      contaId: schema.contaPagar.id,
      contaPaga: schema.contaPagar.dataPagamento,
    })
    .from(schema.notaCompra)
    .innerJoin(
      schema.contaPagar,
      and(eq(schema.contaPagar.notaCompraId, schema.notaCompra.id), isNull(schema.contaPagar.dataDelete)),
    )
    .where(
      and(
        inArray(schema.notaCompra.filialId, filialIds),
        inArray(sql`left(${schema.notaCompra.emitCnpj}, 8)`, raizes),
        gte(schema.notaCompra.dataEmissao, new Date(Date.now() - 180 * 86400000)),
      ),
    );
  // uma linha por nota (nota parcelada tem várias contas: fica a primeira em aberto)
  const porNota = new Map<string, (typeof linhas)[number]>();
  for (const l of linhas) {
    if (contasJaCasadas.has(l.contaId)) continue;
    const atual = porNota.get(l.notaId);
    if (!atual || (atual.contaPaga && !l.contaPaga)) porNota.set(l.notaId, l);
  }
  const notas = [...porNota.values()];
  const usadas = new Set<string>();
  for (const p of pagamentos) {
    const raiz = soDigitos(p.cpfCnpjBeneficiario).slice(0, 8);
    const valor = centavos(p.valorNominal);
    if (raiz.length !== 8 || !valor) continue;
    const pagoEm = (p.dataPagamento ?? '').slice(0, 10);
    const venc = (p.dataVencimentoTitulo || p.dataVencimentoDigitada || pagoEm).slice(0, 10);
    // nota emitida antes do pagamento e no máximo 60 dias antes do vencimento
    const naJanela = (n: (typeof notas)[number]) =>
      !n.emissao || ((!pagoEm || n.emissao <= pagoEm) && (!venc || diasEntre(venc, n.emissao) <= 60));
    const base = notas.filter((n) => !usadas.has(n.notaId) && soDigitos(n.emitCnpj).slice(0, 8) === raiz && naJanela(n));
    const exatas = base.filter((n) => centavos(n.valorTotal) === valor);
    let n = exatas.find((x) => x.filialId === filialId) ?? exatas[0];
    if (!n) {
      const perto = base.filter((x) => Math.abs(centavos(x.valorTotal) - valor) <= 1000);
      const daCasa = perto.filter((x) => x.filialId === filialId);
      const lista = daCasa.length ? daCasa : perto;
      if (lista.length === 1) n = lista[0];
    }
    if (!n) continue;
    usadas.add(n.notaId);
    res.set(p.codigoTransacao, { notaId: n.notaId, filialId: n.filialId, numero: n.numero, contaId: n.contaId, paga: !!n.contaPaga });
  }
  return res;
}
