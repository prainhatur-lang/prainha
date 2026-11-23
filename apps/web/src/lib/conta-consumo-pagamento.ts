// Conta de consumo / boleto fora do DDA pago pelo sistema (tela
// /financeiro/pagar-conta, dono 23/11/2026). Molde do Pix por chave
// (lib/pix-pagamento.ts): a linha de conta_consumo_pagamento nasce ENVIANDO
// antes de chamar o Inter, o id dela vai como idempotência, e a baixa na conta
// a pagar (quando ligada) sai uma vez só (baixado_em).
// Boleto: baixa com a MESMA observação da baixa automática dos boletos do
// Inter ("Boleto pago no Inter (<codigoTransacao>)") — o cron vê e não dobra.

import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { recalcularAgregado } from '@/lib/conta-pagar-baixa';
import { enviarComprovanteContador, enviarComprovantesPendentes } from '@/lib/comprovante-contador';
import { dateToBrYmd, diasAtrasBr, hojeBr } from '@/lib/datas';
import {
  buscarPagamentosBoletoJanelas,
  mesmoCodigoBoleto,
  classificarStatusBoletoInter,
  classificarStatusPixInter,
  consultarPagamentoPixInter,
  type InterCredenciais,
  type InterPagamento,
} from '@/lib/inter';

type Exec = Pick<typeof db, 'execute'>;

export const STATUS_CONSUMO_ABERTO = ['ENVIANDO', 'APROVACAO', 'AGENDADO'] as const;

/** Valor de contas de consumo desta casa que ainda podem sair do saldo. */
export async function consumoComprometido(filialId: string, exec: Exec = db): Promise<{ valor: number; qtd: number }> {
  const rows = (await exec.execute(sql`
    SELECT coalesce(sum(valor), 0)::text AS valor, count(*)::int AS qtd
      FROM conta_consumo_pagamento
     WHERE filial_id = ${filialId}::uuid
       AND status IN ('ENVIANDO','APROVACAO','AGENDADO')
  `)) as unknown as Array<{ valor: string; qtd: number }>;
  return { valor: Math.round(Number(rows[0]?.valor ?? 0) * 100) / 100, qtd: Number(rows[0]?.qtd ?? 0) };
}

/** Este código já foi pago (ou está saindo) por esta tela? */
export async function pagamentoDoMesmoCodigo(
  filialId: string,
  tipo: 'BOLETO' | 'PIX',
  chave: string,
  exec: Exec = db,
): Promise<{ id: string; status: string; criado_em: string } | null> {
  const rows = (await exec.execute(
    tipo === 'BOLETO'
      ? sql`SELECT id, status, criado_em::text FROM conta_consumo_pagamento
             WHERE filial_id = ${filialId}::uuid AND codigo_barras = ${chave}
               AND status IN ('ENVIANDO','APROVACAO','AGENDADO','PAGO')
             ORDER BY criado_em DESC LIMIT 1`
      : sql`SELECT id, status, criado_em::text FROM conta_consumo_pagamento
             WHERE filial_id = ${filialId}::uuid AND tipo = 'PIX' AND codigo = ${chave}
               AND status IN ('ENVIANDO','APROVACAO','AGENDADO','PAGO')
             ORDER BY criado_em DESC LIMIT 1`,
  )) as unknown as Array<{ id: string; status: string; criado_em: string }>;
  return rows[0] ?? null;
}

/**
 * Marca PAGO (uma vez só) e, se tiver conta a pagar ligada, dá a baixa:
 * o saldo da conta como valor, o que passou disso como juros (conta vencida
 * com multa). Se já tem baixa com a mesma observação, não baixa de novo.
 */
export async function baixarContaConsumo(id: string, dataPagamento?: string | null) {
  const r = await baixarContaConsumoTx(id, dataPagamento);
  // comprovante pro contador (dono 23/11/2026) — melhor esforço, uma vez só
  await enviarComprovanteContador(id).catch(() => null);
  return r;
}

async function baixarContaConsumoTx(id: string, dataPagamento?: string | null) {
  return db.transaction(async (tx) => {
    const marcado = (await tx.execute(sql`
      UPDATE conta_consumo_pagamento SET baixado_em = now(), atualizado_em = now(), status = 'PAGO'
       WHERE id = ${id}::uuid AND baixado_em IS NULL
       RETURNING filial_id, tipo, valor::text, conta_pagar_id, codigo_inter, usuario_id
    `)) as unknown as Array<{
      filial_id: string;
      tipo: string;
      valor: string;
      conta_pagar_id: string | null;
      codigo_inter: string | null;
      usuario_id: string | null;
    }>;
    const p = marcado[0];
    if (!p || !p.conta_pagar_id) return { baixada: false };
    const [conta] = await tx
      .select({ id: schema.contaPagar.id, valor: schema.contaPagar.valor, dataDelete: schema.contaPagar.dataDelete })
      .from(schema.contaPagar)
      .where(and(eq(schema.contaPagar.id, p.conta_pagar_id), eq(schema.contaPagar.filialId, p.filial_id)))
      .limit(1);
    if (!conta || conta.dataDelete) return { baixada: false };
    const observacao =
      p.tipo === 'BOLETO'
        ? `Boleto pago no Inter (${p.codigo_inter ?? id})`
        : `Pix copia-e-cola pago pelo sistema (Inter)${p.codigo_inter ? ` cód ${p.codigo_inter}` : ''}`;
    const baixas = await tx
      .select({ valor: schema.contaPagarBaixa.valor, observacao: schema.contaPagarBaixa.observacao })
      .from(schema.contaPagarBaixa)
      .where(eq(schema.contaPagarBaixa.contaPagarId, conta.id));
    if (baixas.some((b) => b.observacao === observacao)) return { baixada: false };
    const saldo = Math.round((Number(conta.valor) - baixas.reduce((s, b) => s + Number(b.valor), 0)) * 100) / 100;
    if (saldo <= 0.005) return { baixada: false };
    const pago = Number(p.valor);
    const valor = Math.min(pago, saldo);
    const juros = Math.round((pago - valor) * 100) / 100;
    const data = dataPagamento && /^\d{4}-\d{2}-\d{2}$/.test(dataPagamento) ? dataPagamento : hojeBr();
    await tx.insert(schema.contaPagarBaixa).values({
      filialId: p.filial_id,
      contaPagarId: conta.id,
      data,
      valor: valor.toFixed(2),
      juros: juros > 0.005 ? juros.toFixed(2) : null,
      observacao,
      criadoPor: p.usuario_id,
    });
    await recalcularAgregado(conta.id, Number(conta.valor), tx);
    return { baixada: true };
  });
}

/**
 * Confere no Inter os pagamentos desta tela ainda sem desfecho. Pago → baixa;
 * recusado/cancelado → ERRO; pendente → só atualiza o status. Boleto sem
 * código do Inter (resposta perdida) é procurado pelo código de barras.
 * Melhor esforço: erro do Inter não derruba quem chamou.
 */
export async function sincronizarContasConsumo(
  filialId: string,
  cred: InterCredenciais,
  limiteMs = 10_000,
): Promise<{ conferidos: number; pagos: number; recusados: number; erro?: string }> {
  const fim = Date.now() + limiteMs;
  const out: { conferidos: number; pagos: number; recusados: number; erro?: string } = { conferidos: 0, pagos: 0, recusados: 0 };
  const semBaixa = (await db.execute(sql`
    SELECT id FROM conta_consumo_pagamento
     WHERE filial_id = ${filialId}::uuid AND status = 'PAGO' AND baixado_em IS NULL
  `)) as unknown as Array<{ id: string }>;
  for (const r of semBaixa) {
    try {
      await baixarContaConsumo(r.id);
      out.pagos += 1;
    } catch (e) {
      console.warn('[conta-consumo] baixa', r.id, e instanceof Error ? e.message : e);
    }
  }
  const abertos = (await db.execute(sql`
    SELECT id, tipo, codigo_barras, codigo_inter, criado_em::text AS criado_em
      FROM conta_consumo_pagamento
     WHERE filial_id = ${filialId}::uuid
       AND status IN ('ENVIANDO','APROVACAO','AGENDADO')
       AND atualizado_em < now() - interval '15 seconds'
     ORDER BY criado_em
     LIMIT 10
  `)) as unknown as Array<{
    id: string;
    tipo: string;
    codigo_barras: string | null;
    codigo_inter: string | null;
    criado_em: string;
  }>;
  // uma consulta (janelas de 30 dias) serve pra todos os boletos abertos
  let lista: InterPagamento[] | null = null;
  for (const p of abertos) {
    if (fim - Date.now() < 1_000) break;
    try {
      if (p.tipo === 'PIX') {
        if (!p.codigo_inter) continue; // sem código: fica no "Saiu / Não saiu" manual
        const c = await consultarPagamentoPixInter(cred, p.codigo_inter);
        out.conferidos += 1;
        const t = c.transacaoPix ?? {};
        const st = String(t.status ?? '');
        await db
          .update(schema.contaConsumoPagamento)
          .set({ statusInter: st || null, ...(t.endToEnd ? { endToEndId: t.endToEnd } : {}), retorno: c as object, atualizadoEm: new Date() })
          .where(eq(schema.contaConsumoPagamento.id, p.id));
        const nosso = classificarStatusPixInter(st);
        if (nosso === 'PAGO') {
          const mov = t.dataHoraMovimento ? new Date(t.dataHoraMovimento) : null;
          await baixarContaConsumo(p.id, mov && !Number.isNaN(mov.getTime()) ? dateToBrYmd(mov) : null);
          out.pagos += 1;
        } else if (nosso === 'ERRO') {
          const motivo = (t.erros ?? []).map((x) => x.descricaoErro ?? x.codigoErro).filter(Boolean).join('; ');
          await marcarErro(p.id, `Inter: ${st}${motivo ? ` — ${motivo}` : ''}`);
          out.recusados += 1;
        }
        continue;
      }
      // BOLETO: procura pelo codigoTransacao ou pelo código de barras
      lista ??= await buscarPagamentosBoletoJanelas(cred, { dataInicio: diasAtrasBr(60), dataFim: hojeBr(), futuroAte: diasAtrasBr(-60) });
      out.conferidos += 1;
      const achado =
        lista.find((x) => p.codigo_inter && x.codigoTransacao === p.codigo_inter) ??
        lista.find((x) => mesmoCodigoBoleto(x.codigoBarra, p.codigo_barras)) ??
        null;
      if (!achado) continue;
      const st = String(achado.statusPagamento ?? '');
      await db
        .update(schema.contaConsumoPagamento)
        .set({
          statusInter: st || null,
          codigoInter: achado.codigoTransacao ?? p.codigo_inter,
          retorno: achado as unknown as object,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.contaConsumoPagamento.id, p.id));
      const nosso = classificarStatusBoletoInter(st);
      if (nosso === 'PAGO' && achado.dataPagamento && achado.dataPagamento.slice(0, 10) <= hojeBr()) {
        await baixarContaConsumo(p.id, achado.dataPagamento.slice(0, 10));
        out.pagos += 1;
      } else if (nosso === 'ERRO') {
        await marcarErro(p.id, `Inter: ${st}`);
        out.recusados += 1;
      } else if (nosso === 'APROVACAO' || nosso === 'AGENDADO') {
        await db
          .update(schema.contaConsumoPagamento)
          .set({ status: nosso })
          .where(and(eq(schema.contaConsumoPagamento.id, p.id), sql`baixado_em IS NULL`));
      }
    } catch (e) {
      console.warn('[conta-consumo] consulta', p.id, e instanceof Error ? e.message : e);
      out.erro = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      break;
    }
  }
  // pagos que ainda não foram pro contador (os de antes do envio e os que falharam)
  if (fim - Date.now() > 3_000) await enviarComprovantesPendentes(filialId, 3).catch(() => 0);
  return out;
}

/** Casas com pagamento desta tela sem desfecho (pro cron conferir sozinho). */
export async function filiaisComContaConsumoAberta(): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT filial_id FROM conta_consumo_pagamento
     WHERE (status IN ('ENVIANDO','APROVACAO','AGENDADO') AND criado_em > now() - interval '60 days')
        OR (status = 'PAGO' AND baixado_em IS NULL)
  `)) as unknown as Array<{ filial_id: string }>;
  return rows.map((r) => r.filial_id);
}

async function marcarErro(id: string, erro: string) {
  await db
    .update(schema.contaConsumoPagamento)
    .set({ status: 'ERRO', erro, atualizadoEm: new Date() })
    .where(and(eq(schema.contaConsumoPagamento.id, id), sql`baixado_em IS NULL`));
}
