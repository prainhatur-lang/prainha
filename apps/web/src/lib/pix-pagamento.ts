// Pix pago pelo sistema (tela Pedidos a pagar por Pix → "Pagar Pix agora").
// Pedido do dono em 20/10/2026. A linha de pix_pagamento nasce ENVIANDO antes
// de chamar o Inter; o id dela vai como chave de idempotência. Conta que está
// num Pix ENVIANDO/APROVACAO/AGENDADO não entra em outro Pix pelo sistema
// (a baixa manual de sempre continua livre).

import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { recalcularAgregado } from '@/lib/conta-pagar-baixa';
import { dateToBrYmd, hojeBr } from '@/lib/datas';
import {
  classificarStatusPixInter,
  consultarPagamentoPixInter,
  consultarSaldoAtualInter,
  type InterCredenciais,
} from '@/lib/inter';

export const STATUS_PIX_ABERTO = ['ENVIANDO', 'APROVACAO', 'AGENDADO'] as const;

/**
 * Quem pode MANDAR dinheiro. Mais estreito que dar baixa
 * (conta_pagar.marcar_pago, que gerente também tem): permissão
 * conta_pagar.pagar_pix, ou grupo Admin enquanto ela não for criada.
 */
export async function podePagarPix(userId: string): Promise<boolean> {
  if (await podeUsuario(userId, 'conta_pagar.pagar_pix')) return true;
  const rows = (await db.execute(sql`
    SELECT 1 FROM usuario_grupo ug JOIN grupo_usuario g ON g.id = ug.grupo_id
     WHERE ug.usuario_id = ${userId}::uuid AND g.nome = 'Admin' LIMIT 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}

/** Ids de conta presos num Pix ainda sem desfecho (da filial). */
export async function contasEmPixAberto(filialId: string): Promise<Set<string>> {
  const rows = (await db.execute(sql`
    SELECT e->>'id' AS id
      FROM pix_pagamento p, jsonb_array_elements(p.conta_ids) e
     WHERE p.filial_id = ${filialId}::uuid
       AND (p.status IN ('ENVIANDO','APROVACAO','AGENDADO') OR (p.status = 'PAGO' AND p.baixado_em IS NULL))
  `)) as unknown as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

type Exec = Pick<typeof db, 'execute'>;

/**
 * Valor de Pix do sistema desta casa que ainda pode sair da conta e que o
 * saldo do Inter talvez ainda não mostre: esperando aprovação, agendado, ou
 * mandado sem resposta do banco (ENVIANDO sem "PROCESSADO"). O que o Inter já
 * processou fica de fora (já saiu do saldo).
 */
export async function pixComprometido(filialId: string, exec: Exec = db): Promise<{ valor: number; qtd: number }> {
  const rows = (await exec.execute(sql`
    SELECT coalesce(sum(valor), 0)::text AS valor, count(*)::int AS qtd
      FROM pix_pagamento
     WHERE filial_id = ${filialId}::uuid
       AND (status IN ('APROVACAO','AGENDADO')
            OR (status = 'ENVIANDO' AND upper(coalesce(status_inter, '')) <> 'PROCESSADO'))
  `)) as unknown as Array<{ valor: string; qtd: number }>;
  return { valor: Math.round(Number(rows[0]?.valor ?? 0) * 100) / 100, qtd: Number(rows[0]?.qtd ?? 0) };
}

export interface SaldoParaPix {
  /** Saldo disponível no Inter agora (sem o limite). */
  disponivel: number;
  /** Pix do sistema sem desfecho (ver pixComprometido). */
  comprometido: number;
  qtdComprometidos: number;
  /** disponivel − comprometido: o teto pra um Pix novo. */
  livre: number;
  consultadoEm: string;
}

/**
 * Saldo pra decidir se um Pix novo pode sair (pedido do dono 22/10/2026).
 * Lê o comprometido ANTES do saldo: se um Pix virar PROCESSADO no meio, ele
 * conta duas vezes (recusa a mais), nunca zero vezes (manda sem saldo).
 * Lança se o Inter não responder — quem chama não manda o Pix.
 */
export async function lerSaldoParaPix(filialId: string, cred: InterCredenciais, exec: Exec = db): Promise<SaldoParaPix> {
  const comp = await pixComprometido(filialId, exec);
  // 10 s: soma com os 45 s do envio do Pix e cabe no teto da rota (90 s).
  const saldo = await consultarSaldoAtualInter(cred, 10_000);
  const livre = Math.round((saldo.disponivel - comp.valor) * 100) / 100;
  return {
    disponivel: Math.round(saldo.disponivel * 100) / 100,
    comprometido: comp.valor,
    qtdComprometidos: comp.qtd,
    livre,
    consultadoEm: new Date().toISOString(),
  };
}

/**
 * Dá baixa nas contas de um Pix que saiu. Uma vez só (baixado_em). Baixa no
 * máximo o saldo que a conta ainda tem — se alguém deu baixa à mão no meio
 * tempo, não paga duas vezes no sistema.
 */
export async function baixarContasDoPix(pixId: string, dataPagamento?: string | null) {
  return db.transaction(async (tx) => {
    const marcado = (await tx.execute(sql`
      UPDATE pix_pagamento SET baixado_em = now(), atualizado_em = now(), status = 'PAGO'
       WHERE id = ${pixId}::uuid AND baixado_em IS NULL
       RETURNING filial_id, conta_ids, codigo_solicitacao, usuario_id
    `)) as unknown as Array<{
      filial_id: string;
      conta_ids: Array<{ id: string; valor: number }>;
      codigo_solicitacao: string | null;
      usuario_id: string | null;
    }>;
    const p = marcado[0];
    if (!p) return { baixadas: 0 };
    const data = dataPagamento && /^\d{4}-\d{2}-\d{2}$/.test(dataPagamento) ? dataPagamento : hojeBr();
    let baixadas = 0;
    for (const item of p.conta_ids) {
      const [conta] = await tx
        .select({ id: schema.contaPagar.id, valor: schema.contaPagar.valor })
        .from(schema.contaPagar)
        .where(and(eq(schema.contaPagar.id, item.id), eq(schema.contaPagar.filialId, p.filial_id)))
        .limit(1);
      if (!conta) continue;
      const jaPago = (
        await tx
          .select({ valor: schema.contaPagarBaixa.valor })
          .from(schema.contaPagarBaixa)
          .where(eq(schema.contaPagarBaixa.contaPagarId, item.id))
      ).reduce((s, x) => s + Number(x.valor), 0);
      const saldo = Number(conta.valor) - jaPago;
      const valor = Math.min(Number(item.valor), saldo);
      if (valor <= 0.005) continue;
      await tx.insert(schema.contaPagarBaixa).values({
        filialId: p.filial_id,
        contaPagarId: item.id,
        data,
        valor: valor.toFixed(2),
        observacao: `Pix enviado pelo sistema (Inter)${p.codigo_solicitacao ? ` cód ${p.codigo_solicitacao}` : ''}`,
        criadoPor: p.usuario_id,
      });
      await recalcularAgregado(item.id, Number(conta.valor), tx);
      baixadas += 1;
    }
    return { baixadas };
  });
}

/**
 * Confere no Inter os Pix do sistema desta casa ainda sem desfecho e fecha os
 * que já se resolveram (caso 27/10/2026, Prainha Bar: 3 Pix aprovados no app
 * do Inter às 16:55 ficaram "APROVACAO" até alguém clicar "Conferir no
 * Inter" — o saldo do banco já tinha caído e o "Livre pra Pix" descontava de
 * novo, deu −R$ 368,90 e travou o Pix seguinte).
 * Pago → baixa nas contas (baixarContasDoPix, uma vez só). Recusado → ERRO
 * (libera as contas). Pendente → só atualiza o status do Inter.
 * Pix sem código do Inter (resposta perdida) não tem o que consultar: segue
 * no "Saiu / Não saiu" manual. Melhor esforço: erro ou demora do Inter não
 * derruba quem chamou — o Pix só continua contado como sem desfecho.
 * Pix mexido há menos de 15 s fica de fora (acabou de ser enviado/conferido).
 */
export async function sincronizarPixAbertos(
  filialId: string,
  cred: InterCredenciais,
  limiteMs = 8_000,
): Promise<{ conferidos: number; pagos: number; recusados: number }> {
  const fim = Date.now() + limiteMs;
  const out = { conferidos: 0, pagos: 0, recusados: 0 };
  // PAGO sem baixa (baixa caiu no meio): só termina a baixa, sem ir ao banco.
  const semBaixa = (await db.execute(sql`
    SELECT id FROM pix_pagamento
     WHERE filial_id = ${filialId}::uuid AND status = 'PAGO' AND baixado_em IS NULL
  `)) as unknown as Array<{ id: string }>;
  for (const r of semBaixa) {
    try {
      await baixarContasDoPix(r.id);
      out.pagos += 1;
    } catch (e) {
      console.warn('[pix-sincronizar] baixa', r.id, e instanceof Error ? e.message : e);
    }
  }
  const abertos = (await db.execute(sql`
    SELECT id, codigo_solicitacao FROM pix_pagamento
     WHERE filial_id = ${filialId}::uuid
       AND status IN ('ENVIANDO','APROVACAO','AGENDADO')
       AND codigo_solicitacao IS NOT NULL
       AND atualizado_em < now() - interval '15 seconds'
     ORDER BY criado_em
     LIMIT 10
  `)) as unknown as Array<{ id: string; codigo_solicitacao: string }>;
  for (const p of abertos) {
    const resta = fim - Date.now();
    if (resta < 1_000) break;
    let consulta;
    try {
      consulta = await Promise.race([
        consultarPagamentoPixInter(cred, p.codigo_solicitacao),
        new Promise<null>((r) => setTimeout(() => r(null), resta)),
      ]);
    } catch (e) {
      console.warn('[pix-sincronizar] consulta', p.id, e instanceof Error ? e.message : e);
      break; // token/limite do Inter: não insiste nos outros agora
    }
    if (!consulta) break;
    out.conferidos += 1;
    const t = consulta.transacaoPix ?? {};
    const statusInter = String(t.status ?? '');
    const nosso = classificarStatusPixInter(statusInter);
    await db
      .update(schema.pixPagamento)
      .set({
        statusInter: statusInter || null,
        ...(t.endToEnd ? { endToEndId: t.endToEnd } : {}),
        retorno: consulta as object,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.pixPagamento.id, p.id));
    if (nosso === 'PAGO') {
      const mov = t.dataHoraMovimento ? new Date(t.dataHoraMovimento) : null;
      const data = mov && !Number.isNaN(mov.getTime()) ? dateToBrYmd(mov) : null;
      await baixarContasDoPix(p.id, data);
      out.pagos += 1;
    } else if (nosso === 'ERRO') {
      const motivo = (t.erros ?? []).map((x) => x.descricaoErro ?? x.codigoErro).filter(Boolean).join('; ');
      await db
        .update(schema.pixPagamento)
        .set({ status: 'ERRO', erro: `Inter: ${statusInter}${motivo ? ` — ${motivo}` : ''}`, atualizadoEm: new Date() })
        .where(and(eq(schema.pixPagamento.id, p.id), sql`baixado_em IS NULL`));
      out.recusados += 1;
    }
  }
  if (out.conferidos || out.pagos) console.info('[pix-sincronizar]', { filialId, ...out });
  return out;
}

/** Casas com Pix do sistema sem desfecho que dá pra conferir no Inter (cron). */
export async function filiaisComPixAberto(): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT filial_id::text AS id FROM pix_pagamento
     WHERE (status IN ('ENVIANDO','APROVACAO','AGENDADO') AND codigo_solicitacao IS NOT NULL)
        OR (status = 'PAGO' AND baixado_em IS NULL)
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}
