// Conferência automática dos Pix do sistema que ainda estão em andamento
// (22/10/2026). Caso: Pix da SS suprimentos (Tabuará) ficou "Pix em andamento"
// porque o Inter pediu APROVAÇÃO no app; depois de aprovar, ninguém clicava em
// "Conferir no Inter" e a conta não baixava. Ao abrir /financeiro/pedidos-pix a
// tela confere sozinha — mesma regra da rota /api/financeiro/pedidos-pix/conferir
// (que continua igual): pago → baixa; recusado/expirado → libera as contas;
// pendente → só grava o status do Inter.

import { sql, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { classificarStatusPixInter, consultarPagamentoPixInter, resolverCredenciaisInterPagamentos } from '@/lib/inter';
import { baixarContasDoPix } from '@/lib/pix-pagamento';
import { dateToBrYmd } from '@/lib/datas';

const LIMITE = 10;
const TEMPO_MS = 7_000;

function comTempo<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), ms))]);
}

/** Confere no Inter os Pix abertos (com código) desta casa. Nunca lança erro. */
export async function conferirPixAbertosNoInter(filialId: string): Promise<{ baixados: number; liberados: number }> {
  const out = { baixados: 0, liberados: 0 };
  const cred = resolverCredenciaisInterPagamentos(filialId);
  if (!cred) return out;
  let abertos: Array<{ id: string; codigo: string }>;
  try {
    abertos = (await db.execute(sql`
      SELECT id, codigo_solicitacao AS codigo
        FROM pix_pagamento
       WHERE filial_id = ${filialId}::uuid
         AND baixado_em IS NULL
         AND codigo_solicitacao IS NOT NULL
         AND status IN ('ENVIANDO','APROVACAO','AGENDADO','PAGO')
       ORDER BY criado_em DESC
       LIMIT ${LIMITE}
    `)) as unknown as Array<{ id: string; codigo: string }>;
  } catch (e) {
    console.error('[pix-conferir-auto] listar', e);
    return out;
  }
  await Promise.all(
    abertos.map(async (p) => {
      try {
        const consulta = await comTempo(consultarPagamentoPixInter(cred, p.codigo), TEMPO_MS);
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
          out.baixados++;
        } else if (nosso === 'ERRO') {
          const motivo = (t.erros ?? []).map((x) => x.descricaoErro ?? x.codigoErro).filter(Boolean).join('; ');
          await db
            .update(schema.pixPagamento)
            .set({
              status: 'ERRO',
              erro: `Inter: ${statusInter}${motivo ? ` — ${motivo}` : ''} (conferido automático)`,
              atualizadoEm: new Date(),
            })
            .where(eq(schema.pixPagamento.id, p.id));
          out.liberados++;
        }
      } catch (e) {
        console.error('[pix-conferir-auto]', p.id, e instanceof Error ? e.message : e);
      }
    }),
  );
  return out;
}

/** Conta → situação do Pix em andamento, pra explicar a etiqueta na tela. */
export async function situacaoPixDasContas(filialId: string): Promise<Record<string, string>> {
  const rows = (await db.execute(sql`
    SELECT e->>'id' AS id, p.status, upper(coalesce(p.status_inter, '')) AS si
      FROM pix_pagamento p, jsonb_array_elements(p.conta_ids) e
     WHERE p.filial_id = ${filialId}::uuid
       AND (p.status IN ('ENVIANDO','APROVACAO','AGENDADO') OR (p.status = 'PAGO' AND p.baixado_em IS NULL))
  `)) as unknown as Array<{ id: string; status: string; si: string }>;
  const m: Record<string, string> = {};
  for (const r of rows) {
    m[r.id] =
      r.status === 'APROVACAO' || r.si.includes('APROVA')
        ? 'falta aprovar no app do Inter'
        : r.status === 'AGENDADO' || r.si.includes('AGENDA')
          ? 'agendado no Inter'
          : r.status === 'PAGO'
            ? 'pago, baixando'
            : 'enviado, esperando o Inter';
  }
  return m;
}
