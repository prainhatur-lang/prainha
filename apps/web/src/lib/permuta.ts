// Permuta / parceria comercial (pedido do dono 31/10/2026).
//
// A empresa parceira entrega algo (serviço, produto, divulgação) e em troca
// ganha CRÉDITO pra consumir nas casas. Ex.: contrato de R$ 2.500 → R$ 1.250
// no Prainha Bar e R$ 1.250 no Prainha Mar.
//
// Como o crédito chega no PDV:
//  1. Acha o parceiro (pelo CPF/CNPJ) no cadastro de clientes da casa. Se não
//     existe, pede o cadastro à loja pela fila `agente_comando` (criar_cliente)
//     já com o fiado ligado e travado no limite (limite 0,01 + bloquear venda
//     após o limite): ele só consome até o crédito.
//  2. Com o código do cliente em mãos, lança um PAGAMENTO na conta corrente
//     dele pela fila `fiado_lancamento` (forma 20 — crédito virtual). Saldo
//     negativo = crédito a consumir; cada consumo no fiado vai abatendo.
//     Mesmo jeito da permuta da Pinheiro Vigilância.
//
// `processarPermutas` é idempotente: roda no cron de 5 min, ao abrir a tela e
// no botão "tentar de novo".
//
// Liberação mensal (11/11/2026): contrato de crédito com `liberacaoMeses` não
// entra inteiro. Cada casa ganha N linhas em `permuta_liberacao`; com o
// cadastro pronto o crédito fica 'mensal' e `processarLiberacoes` lança a
// parcela no dia dela (mesma fila do fiado, forma 20). Sem `liberacaoMeses`,
// nada muda: o crédito entra de uma vez.

import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { normalizarCliente } from '@/lib/cliente-cadastro';
import { garantirFornecedorDoPedido } from '@/lib/pedido-sem-nota';
import { hojeBr } from '@/lib/datas';

/** Forma do PDV usada no crédito: "Programa de fidelidade, Cashback, Crédito Virtual". */
export const PERMUTA_FORMA_CODIGO = 20;

export const BUCKET_PERMUTA = 'extratos-fechamento';
export const PERMUTA_EXTENSOES = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'doc', 'docx'];
export const PERMUTA_TAMANHO_MAX = 25 * 1024 * 1024;

const soDig = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

type Credito = typeof schema.permutaCredito.$inferSelect;
type Contrato = typeof schema.permutaContrato.$inferSelect;

/** Cliente da casa com esse CPF/CNPJ (com código do PDV). */
async function clienteDaCasa(filialId: string, doc: string) {
  if (!doc) return null;
  const [c] = await db
    .select({
      codigo: schema.cliente.codigoExterno,
      nome: schema.cliente.nome,
      limite: schema.cliente.limiteCreditoContaCorrente,
    })
    .from(schema.cliente)
    .where(
      and(
        eq(schema.cliente.filialId, filialId),
        isNull(schema.cliente.dataDelete),
        sql`${schema.cliente.codigoExterno} IS NOT NULL`,
        sql`regexp_replace(coalesce(${schema.cliente.cpfOuCnpj}, ''), '[^0-9]', '', 'g') = ${doc}`,
      ),
    )
    .limit(1);
  return c && c.codigo != null ? c : null;
}

/** Pede o cadastro do parceiro à loja (ou reaproveita um pedido já na fila). */
async function pedirCadastro(contrato: Contrato, filialId: string): Promise<string> {
  const doc = soDig(contrato.documento);
  if (doc) {
    const [naFila] = await db
      .select({ id: schema.agenteComando.id })
      .from(schema.agenteComando)
      .where(
        and(
          eq(schema.agenteComando.filialId, filialId),
          eq(schema.agenteComando.tipo, 'criar_cliente'),
          sql`${schema.agenteComando.status} <> 'erro'`,
          sql`${schema.agenteComando.payload}->'campos'->>'cnpjOuCpf' = ${doc}`,
        ),
      )
      .limit(1);
    if (naFila) return naFila.id;
  }
  const fone = soDig(contrato.telefone);
  const email = (contrato.email ?? '').trim();
  const campos = normalizarCliente(
    {
      nome: contrato.parceiroNome,
      cpfOuCnpj: doc || null,
      ...(fone.length >= 10 ? { celular: fone } : {}),
      ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email } : {}),
      observacao:
        contrato.tipo === 'receber'
          ? `Parceiro — valor a receber do contrato ${contrato.id.slice(0, 8)}`
          : `Parceiro de permuta — crédito para consumo (contrato ${contrato.id.slice(0, 8)})`,
      // Fiado ligado, mas travado: só consome até o crédito.
      limiteCreditoContaCorrente: 0.01,
      bloquearVendaAposLimite: true,
    },
    { exigirNome: true },
  );
  const [cmd] = await db
    .insert(schema.agenteComando)
    .values({ filialId, tipo: 'criar_cliente', payload: { campos: campos.loja, origem: 'permuta' } })
    .returning({ id: schema.agenteComando.id });
  return cmd!.id;
}

/** Contrato de crédito liberado mês a mês? */
const ehMensal = (k: Pick<Contrato, 'tipo' | 'liberacaoMeses'>) => k.tipo === 'credito' && (k.liberacaoMeses ?? 0) > 1;

/** `inicio` + n meses, no mesmo dia (31 em mês curto cai no último dia). */
export function somarMeses(inicio: string, n: number): string {
  const [a, m, d] = inicio.split('-').map(Number) as [number, number, number];
  const idx = a * 12 + (m - 1) + n;
  const ano = Math.floor(idx / 12);
  const mes = (idx % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

/** Divide o valor da casa em N liberações mensais iguais (a sobra de centavos vai na última). */
export function liberacoesDaCasa(valorCasa: number, meses: number, inicio: string): Array<{ numero: number; data: string; valor: number }> {
  const cent = Math.round(valorCasa * 100);
  const base = Math.floor(cent / meses);
  return Array.from({ length: meses }, (_, i) => ({
    numero: i + 1,
    data: somarMeses(inicio, i),
    valor: (i === meses - 1 ? cent - base * (meses - 1) : base) / 100,
  }));
}

/** Contrato mensal: o cadastro existe → guarda o código; o crédito sai por `processarLiberacoes`. */
async function marcarMensal(cred: Credito, codigo: number) {
  await db
    .update(schema.permutaCredito)
    .set({ status: 'mensal', clienteCodigoExterno: codigo, erro: null })
    .where(eq(schema.permutaCredito.id, cred.id));
}

/**
 * Lança as liberações mensais que já venceram (data <= hoje) de contratos não
 * cancelados cujo parceiro já tem cadastro na casa. Cada uma vira um PAGAMENTO
 * na fila do fiado (forma 20). A troca 'agendada' → 'lancada' e o lançamento
 * vão na mesma transação: cron e tela rodando juntos não lançam em dobro, e se
 * o lançamento falhar a liberação continua agendada pra próxima rodada.
 */
export async function processarLiberacoes(opts: { contratoId?: string } = {}) {
  const pendentes = await db
    .select({
      id: schema.permutaLiberacao.id,
      numero: schema.permutaLiberacao.numero,
      valor: schema.permutaLiberacao.valor,
      filialId: schema.permutaLiberacao.filialId,
      codigo: schema.permutaCredito.clienteCodigoExterno,
      parceiroNome: schema.permutaContrato.parceiroNome,
      meses: schema.permutaContrato.liberacaoMeses,
      criadoPor: schema.permutaContrato.criadoPor,
    })
    .from(schema.permutaLiberacao)
    .innerJoin(schema.permutaCredito, eq(schema.permutaCredito.id, schema.permutaLiberacao.creditoId))
    .innerJoin(schema.permutaContrato, eq(schema.permutaContrato.id, schema.permutaLiberacao.contratoId))
    .where(
      and(
        eq(schema.permutaLiberacao.status, 'agendada'),
        sql`${schema.permutaLiberacao.data} <= ${hojeBr()}::date`,
        eq(schema.permutaCredito.status, 'mensal'),
        sql`${schema.permutaCredito.clienteCodigoExterno} IS NOT NULL`,
        isNull(schema.permutaContrato.canceladoEm),
        opts.contratoId ? eq(schema.permutaLiberacao.contratoId, opts.contratoId) : undefined,
      ),
    )
    .orderBy(schema.permutaLiberacao.data, schema.permutaLiberacao.numero);
  if (pendentes.length === 0) return { liberadas: 0 };
  const [forma] = await db
    .select({ descricao: schema.formaPagamentoConsumer.descricao })
    .from(schema.formaPagamentoConsumer)
    .where(eq(schema.formaPagamentoConsumer.codigo, PERMUTA_FORMA_CODIGO))
    .limit(1);
  let n = 0;
  for (const l of pendentes) {
    try {
      const fez = await db.transaction(async (tx) => {
        const [minha] = await tx
          .update(schema.permutaLiberacao)
          .set({ status: 'lancada', lancadoEm: new Date() })
          .where(and(eq(schema.permutaLiberacao.id, l.id), eq(schema.permutaLiberacao.status, 'agendada')))
          .returning({ id: schema.permutaLiberacao.id });
        if (!minha) return false; // outra rodada pegou
        const [f] = await tx
          .insert(schema.fiadoLancamento)
          .values({
            filialId: l.filialId,
            clienteCodigoExterno: l.codigo!,
            clienteNome: l.parceiroNome,
            tipo: 'pagamento',
            valor: Number(l.valor).toFixed(2),
            formaCodigo: PERMUTA_FORMA_CODIGO,
            formaNome: forma?.descricao ?? 'Crédito Virtual',
            condicao: 'avista',
            vencimento: null,
            criadoPor: l.criadoPor ?? 'permuta',
            observacao: `Permuta — crédito do mês ${l.numero}/${l.meses ?? '?'} (${l.parceiroNome})`.slice(0, 200),
          })
          .returning({ id: schema.fiadoLancamento.id });
        await tx.update(schema.permutaLiberacao).set({ fiadoLancamentoId: f!.id }).where(eq(schema.permutaLiberacao.id, l.id));
        return true;
      });
      if (fez) n++;
    } catch {
      // fica agendada; a próxima rodada tenta de novo
    }
  }
  return { liberadas: n };
}

/** Lança o crédito na conta corrente do parceiro (fila do fiado). */
async function lancarCredito(contrato: Contrato, cred: Credito, codigo: number, nome: string | null) {
  if (contrato.tipo === 'receber') return lancarReceber(contrato, cred, codigo, nome);
  const [forma] = await db
    .select({ descricao: schema.formaPagamentoConsumer.descricao })
    .from(schema.formaPagamentoConsumer)
    .where(eq(schema.formaPagamentoConsumer.codigo, PERMUTA_FORMA_CODIGO))
    .limit(1);
  const obs = `Permuta — crédito para consumo (${contrato.parceiroNome})`.slice(0, 200);
  const [f] = await db
    .insert(schema.fiadoLancamento)
    .values({
      filialId: cred.filialId,
      clienteCodigoExterno: codigo,
      clienteNome: nome ?? contrato.parceiroNome,
      tipo: 'pagamento',
      valor: Number(cred.valor).toFixed(2),
      formaCodigo: PERMUTA_FORMA_CODIGO,
      formaNome: forma?.descricao ?? 'Crédito Virtual',
      condicao: 'avista',
      vencimento: null,
      criadoPor: contrato.criadoPor ?? 'permuta',
      observacao: obs,
    })
    .returning({ id: schema.fiadoLancamento.id });
  await db
    .update(schema.permutaCredito)
    .set({ status: 'lancado', clienteCodigoExterno: codigo, fiadoLancamentoId: f!.id, erro: null, lancadoEm: new Date() })
    .where(eq(schema.permutaCredito.id, cred.id));
}

/**
 * Divide o valor da casa pelas parcelas do contrato, na proporção de cada
 * parcela; os centavos que sobram vão na última. Sem parcelas = uma só.
 */
export function parcelasDaCasa(
  valorCasa: number,
  vencimentos: Array<{ data: string; valor: number }> | null | undefined,
  padrao: string,
): Array<{ data: string; valor: number }> {
  const venc = (vencimentos ?? []).filter((v) => v.valor > 0).sort((a, b) => a.data.localeCompare(b.data));
  const totalC = Math.round(valorCasa * 100);
  if (venc.length === 0) return [{ data: padrao, valor: totalC / 100 }];
  const soma = venc.reduce((s, v) => s + v.valor, 0);
  let usado = 0;
  return venc.map((v, i) => {
    const c = i === venc.length - 1 ? totalC - usado : Math.round((totalC * v.valor) / soma);
    usado += c;
    return { data: v.data, valor: c / 100 };
  });
}

/** Contrato "a receber": o parceiro deve à casa → débito no fiado, a prazo. */
async function lancarReceber(contrato: Contrato, cred: Credito, codigo: number, nome: string | null) {
  const parcelas = parcelasDaCasa(Number(cred.valor), contrato.vencimentos, contrato.dataInicio ?? hojeBr());
  const lista = parcelas.map((p) => `${p.data.split('-').reverse().join('/')} R$ ${p.valor.toFixed(2)}`).join(', ');
  const obs = `Parceria — a receber (${contrato.parceiroNome})${parcelas.length > 1 ? ` · parcelas: ${lista}` : ''}`.slice(0, 200);
  const [f] = await db
    .insert(schema.fiadoLancamento)
    .values({
      filialId: cred.filialId,
      clienteCodigoExterno: codigo,
      clienteNome: nome ?? contrato.parceiroNome,
      tipo: 'credito',
      valor: Number(cred.valor).toFixed(2),
      condicao: 'prazo',
      vencimento: parcelas[0]!.data,
      criadoPor: contrato.criadoPor ?? 'permuta',
      observacao: obs,
    })
    .returning({ id: schema.fiadoLancamento.id });
  await db
    .update(schema.permutaCredito)
    .set({ status: 'lancado', clienteCodigoExterno: codigo, fiadoLancamentoId: f!.id, erro: null, lancadoEm: new Date() })
    .where(eq(schema.permutaCredito.id, cred.id));
}

/**
 * Contrato "a pagar": a casa paga o parceiro → uma conta a pagar MANUAL por
 * parcela, com o parceiro como fornecedor da casa (copia de outra casa, acha
 * pelo nome ou cria pela Receita).
 */
export async function lancarContasPagar(contrato: Contrato, cred: Credito, criadoPorId: string | null) {
  if (cred.contaPagarIds?.length) return; // já lançou
  const forn = await garantirFornecedorDoPedido(cred.filialId, {
    fornecedorCnpj: contrato.documento,
    fornecedorNome: contrato.parceiroNome,
  });
  const parcelas = parcelasDaCasa(Number(cred.valor), contrato.vencimentos, contrato.dataInicio ?? hojeBr());
  const desc = `Parceria — ${contrato.parceiroNome}`.slice(0, 200);
  const obs = [contrato.contrapartida, `Contrato de permuta/parceria ${contrato.id.slice(0, 8)}`].filter(Boolean).join(' · ');
  const ids = await db.transaction(async (tx) => {
    const out: string[] = [];
    for (const [i, p] of parcelas.entries()) {
      const [c] = await tx
        .insert(schema.contaPagar)
        .values({
          filialId: cred.filialId,
          fornecedorId: forn?.id ?? null,
          categoriaId: null,
          descricao: desc,
          observacao: obs.slice(0, 1000),
          valor: p.valor.toFixed(2),
          dataVencimento: p.data,
          competencia: p.data.slice(0, 7),
          ...(parcelas.length > 1 ? { parcela: i + 1, totalParcelas: parcelas.length } : {}),
          origem: 'MANUAL',
          criadoPor: criadoPorId,
          criadoEm: new Date(),
          dataCadastro: new Date(`${hojeBr()}T12:00:00-03:00`),
        })
        .returning({ id: schema.contaPagar.id });
      out.push(c!.id);
    }
    await tx
      .update(schema.permutaCredito)
      .set({ status: 'lancado', contaPagarIds: out, erro: null, lancadoEm: new Date() })
      .where(eq(schema.permutaCredito.id, cred.id));
    return out;
  });
  return ids;
}

/** Avança um crédito: acha/cria o cliente e lança. Nunca estoura. */
async function avancar(contrato: Contrato, cred: Credito): Promise<void> {
  try {
    if (cred.status !== 'aguardando_cadastro' && cred.status !== 'erro') return;
    if (cred.fiadoLancamentoId) return; // já lançado (proteção contra lançar 2x)
    if (contrato.tipo === 'pagar') {
      await lancarContasPagar(contrato, cred, null);
      return;
    }
    const doc = soDig(contrato.documento);

    // 1. Já tem cadastro na casa?
    const cli = await clienteDaCasa(cred.filialId, doc);
    if (cli && ehMensal(contrato)) return marcarMensal(cred, cli.codigo!);
    if (cli) return lancarCredito(contrato, cred, cli.codigo!, cli.nome);

    // 2. Cadastro pedido à loja: a loja devolve o código no resultado.
    if (cred.agenteComandoId) {
      const [cmd] = await db
        .select({ status: schema.agenteComando.status, resultado: schema.agenteComando.resultado })
        .from(schema.agenteComando)
        .where(eq(schema.agenteComando.id, cred.agenteComandoId))
        .limit(1);
      const res = (cmd?.resultado ?? {}) as { codigo?: number | string; erro?: string; error?: string; mensagem?: string; msg?: string };
      const codigo = Number(res.codigo);
      if (cmd?.status === 'sucesso' && Number.isInteger(codigo) && codigo > 0 && ehMensal(contrato)) {
        return marcarMensal(cred, codigo);
      }
      if (cmd?.status === 'sucesso' && Number.isInteger(codigo) && codigo > 0) {
        return lancarCredito(contrato, cred, codigo, contrato.parceiroNome);
      }
      if (cmd?.status === 'erro') {
        await db
          .update(schema.permutaCredito)
          .set({
            status: 'erro',
            erro: `a loja não criou o cadastro: ${String(res.msg ?? res.erro ?? res.error ?? res.mensagem ?? 'sem detalhe').slice(0, 300)}`,
            agenteComandoId: null, // "tentar de novo" pede outro cadastro
          })
          .where(eq(schema.permutaCredito.id, cred.id));
      }
      return; // pendente/executando: espera a loja
    }

    // 3. Pede o cadastro.
    const id = await pedirCadastro(contrato, cred.filialId);
    await db
      .update(schema.permutaCredito)
      .set({ status: 'aguardando_cadastro', agenteComandoId: id, erro: null })
      .where(eq(schema.permutaCredito.id, cred.id));
  } catch (e) {
    await db
      .update(schema.permutaCredito)
      .set({ status: 'erro', erro: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
      .where(eq(schema.permutaCredito.id, cred.id))
      .catch(() => {});
  }
}

/**
 * Avança todos os créditos que faltam lançar (ou só os de um contrato).
 * `incluirErro` = botão "tentar de novo".
 */
export async function processarPermutas(opts: { contratoId?: string; incluirErro?: boolean } = {}) {
  const status = opts.incluirErro ? ['aguardando_cadastro', 'erro'] : ['aguardando_cadastro'];
  const creds = await db
    .select()
    .from(schema.permutaCredito)
    .where(
      and(
        inArray(schema.permutaCredito.status, status),
        opts.contratoId ? eq(schema.permutaCredito.contratoId, opts.contratoId) : undefined,
      ),
    );
  if (creds.length === 0) {
    await processarLiberacoes({ contratoId: opts.contratoId }).catch(() => {});
    return { avancados: 0 };
  }
  const contratos = await db
    .select()
    .from(schema.permutaContrato)
    .where(and(inArray(schema.permutaContrato.id, [...new Set(creds.map((c) => c.contratoId))]), isNull(schema.permutaContrato.canceladoEm)));
  const porId = new Map(contratos.map((c) => [c.id, c]));
  let n = 0;
  for (const c of creds) {
    const k = porId.get(c.contratoId);
    if (!k) continue;
    await avancar(k, c);
    n++;
  }
  // Parcela do mês dos contratos liberados aos poucos (inclusive a 1ª, logo que o cadastro sai).
  await processarLiberacoes({ contratoId: opts.contratoId }).catch(() => {});
  return { avancados: n };
}
