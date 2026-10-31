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

import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { normalizarCliente } from '@/lib/cliente-cadastro';

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
      observacao: `Parceiro de permuta — crédito para consumo (contrato ${contrato.id.slice(0, 8)})`,
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

/** Lança o crédito na conta corrente do parceiro (fila do fiado). */
async function lancarCredito(contrato: Contrato, cred: Credito, codigo: number, nome: string | null) {
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

/** Avança um crédito: acha/cria o cliente e lança. Nunca estoura. */
async function avancar(contrato: Contrato, cred: Credito): Promise<void> {
  try {
    if (cred.status !== 'aguardando_cadastro' && cred.status !== 'erro') return;
    if (cred.fiadoLancamentoId) return; // já lançado (proteção contra lançar 2x)
    const doc = soDig(contrato.documento);

    // 1. Já tem cadastro na casa?
    const cli = await clienteDaCasa(cred.filialId, doc);
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
  if (creds.length === 0) return { avancados: 0 };
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
  return { avancados: n };
}
