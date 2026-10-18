// Relatório de UMA casa, sem os 10%, pra quem não recebe o relatório completo
// (18/10/2026, pedido do dono: o Lula recebe só a Prainha Mar, faturamento
// líquido e os períodos já sem o serviço).
//
// Vai pelo mesmo modelo `relatorio_diario` (o destinatário não falou com a
// casa, então texto livre não chega) — {{2}} leva a linha da casa. Cada dia
// que ainda não foi pra pessoa sai uma vez: o cron das 07:00 manda o de
// ontem e, se ficou buraco desde `desde`, completa (limite por rodada).

import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { faturamentoSemServico, montarRelatorioFiliais, reais, somaDias, ultimoDiaFechado, type RelatorioCasa } from './relatorio-diario';
import { enviarModelo, registrar, type OrigemEnvio } from './relatorio-diario-envio';

export interface DestinoCasa {
  nome: string;
  telefone: string;
  filialId: string;
  /** primeiro dia que a pessoa recebe */
  desde: string;
}

export const DESTINOS_CASA: DestinoCasa[] = [
  // 03 Prainha Mar → Lula
  { nome: 'Lula', telefone: '5579999550771', filialId: 'e899dae2-38bf-4f3f-9149-7effd059fab8', desde: '2026-10-01' },
];

const MAX_POR_RODADA = 20;

/** "Prainha Mar — faturamento líquido (sem os 10%): R$ 13.065 · 52 contas · Almoço 23 contas R$ 6.787 (pico 10 mesas às 14:30) · …" */
export function linhaCasaSemServico(c: RelatorioCasa): string {
  if (!c.temMovimento || !c.movimento.contas) return `${c.nome} — sem movimento no dia.`;
  const liquido = faturamentoSemServico(c);
  const pers = c.periodos
    .map(
      (p) =>
        `${p.nome} ${p.contas} ${p.contas === 1 ? 'conta' : 'contas'} ${reais(p.total - (p.servico ?? 0), false)}` +
        (p.pico >= 5 ? ` (pico ${p.pico} mesas às ${p.picoHora})` : ''),
    )
    .join(' · ');
  return (
    `${c.nome} — faturamento líquido (sem os 10%): ${reais(liquido, false)} · ` +
    `${c.movimento.contas} ${c.movimento.contas === 1 ? 'conta' : 'contas'}` +
    (pers ? ` · ${pers}` : '')
  );
}

export interface ResultadoCasa {
  nome: string;
  telefone: string;
  dia: string;
  ok: boolean;
  erro?: string;
}

/** Manda pra cada destino os dias que faltam (de `desde` até ontem). */
export async function enviarRelatoriosPorCasa(origem: OrigemEnvio = 'cron'): Promise<ResultadoCasa[]> {
  const ate = ultimoDiaFechado();
  const saida: ResultadoCasa[] = [];
  for (const d of DESTINOS_CASA) {
    const [filial] = (await db.execute(sql`
      SELECT id, nome, organizacao_id FROM filial WHERE id = ${d.filialId}::uuid
    `)) as unknown as Array<{ id: string; nome: string; organizacao_id: string }>;
    if (!filial) continue;
    const feitos = await db
      .select({ dia: schema.relatorioDiarioEnvio.dia })
      .from(schema.relatorioDiarioEnvio)
      .where(
        and(
          eq(schema.relatorioDiarioEnvio.organizacaoId, filial.organizacao_id),
          eq(schema.relatorioDiarioEnvio.telefone, d.telefone),
          eq(schema.relatorioDiarioEnvio.ok, true),
          inArray(schema.relatorioDiarioEnvio.canal, ['texto', 'modelo']),
        ),
      );
    const jaFoi = new Set(feitos.map((f) => String(f.dia)));
    const faltam: string[] = [];
    for (let dia = d.desde; dia <= ate; dia = somaDias(dia, 1)) if (!jaFoi.has(dia)) faltam.push(dia);

    for (const dia of faltam.slice(0, MAX_POR_RODADA)) {
      const [casa] = await montarRelatorioFiliais([{ id: filial.id, nome: filial.nome }], dia);
      if (!casa) continue;
      const m = await enviarModelo(d.telefone, dia, linhaCasaSemServico(casa));
      await registrar({
        organizacaoId: filial.organizacao_id,
        dia,
        telefone: d.telefone,
        canal: 'modelo',
        origem,
        ok: !!m.waMessageId,
        erro: m.erro ?? null,
        waMessageId: m.waMessageId,
        phoneNumberId: m.phoneNumberId || null,
      });
      saida.push({ nome: d.nome, telefone: d.telefone, dia, ok: !!m.waMessageId, erro: m.erro });
      if (!m.waMessageId) break; // modelo/conta com problema: não insiste no resto
    }
  }
  return saida;
}
